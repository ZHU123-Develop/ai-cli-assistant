// ============================================================
// AI 模型适配器 — 支持 Anthropic / OpenAI / 自定义
// ============================================================

import { Message, ModelConfig, ToolCall, StreamEvent } from '@ai-cli/shared';
import { MCPToolExecutor, MCPTool } from '@ai-cli/tools';

export abstract class AIProvider {
  protected config: ModelConfig;
  protected toolExecutor: MCPToolExecutor;

  constructor(config: ModelConfig, toolExecutor: MCPToolExecutor) {
    this.config = config;
    this.toolExecutor = toolExecutor;
  }

  abstract chatStream(messages: Message[], onEvent: (event: StreamEvent) => void): Promise<void>;
}

// ==================== Anthropic Claude ====================

export class AnthropicProvider extends AIProvider {
  private client: any; // Anthropic SDK v0.52 类型不稳定，使用 any

  constructor(config: ModelConfig, toolExecutor: MCPToolExecutor) {
    super(config, toolExecutor);
    const Anthropic = require('@anthropic-ai/sdk');
    const AnthropicClass = Anthropic.default || Anthropic;
    this.client = new AnthropicClass({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    });
  }

  private convertTools(tools: MCPTool[]): any[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  async chatStream(messages: Message[], onEvent: (event: StreamEvent) => void): Promise<void> {
    const tools = this.toolExecutor.getToolDefinitions();
    const anthropicMessages: Array<{ role: string; content: string }> = messages.map((m) => ({
      role: m.role === 'system' ? 'user' : m.role,
      content: m.content,
    }));

    const stream = await this.client.messages.stream({
      model: this.config.model,
      max_tokens: this.config.maxTokens || 4096,
      temperature: this.config.temperature ?? 0.3,
      system: messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n'),
      messages: anthropicMessages.filter((m) => m.role !== 'system'),
      tools: this.convertTools(tools),
      stream: true,
    });

    let fullText = '';
    let toolUseId = '';
    let toolUseName = '';
    let toolUseInput = '';
    const toolCalls: ToolCall[] = [];

    for await (const event of stream) {
      switch (event.type) {
        case 'content_block_start': {
          if (event.content_block.type === 'text') {
            fullText = '';
          } else if (event.content_block.type === 'tool_use') {
            toolUseId = event.content_block.id;
            toolUseName = event.content_block.name;
            toolUseInput = '';
          }
          break;
        }
        case 'content_block_delta': {
          if (event.delta.type === 'text_delta') {
            fullText += event.delta.text;
            onEvent({ type: 'text', content: event.delta.text });
          } else if (event.delta.type === 'input_json_delta') {
            toolUseInput += event.delta.partial_json;
          }
          break;
        }
        case 'content_block_stop': {
          if (toolUseId) {
            let inputObj: Record<string, unknown> = {};
            try {
              inputObj = JSON.parse(toolUseInput);
            } catch {
              // ignore
            }
            const call: ToolCall = { id: toolUseId, name: toolUseName, arguments: inputObj };
            toolCalls.push(call);
            onEvent({ type: 'tool_call', call });

            const result = await this.toolExecutor.execute(call);
            onEvent({ type: 'tool_result', result });

            toolUseId = '';
            toolUseName = '';
            toolUseInput = '';
          }
          break;
        }
        case 'message_stop': {
          onEvent({ type: 'done' });
          break;
        }
        case 'error':
        case 'message_delta':
          break;
      }
    }
  }
}

// ==================== OpenAI ====================

export class OpenAIProvider extends AIProvider {
  private client: import('openai').OpenAI;

  constructor(config: ModelConfig, toolExecutor: MCPToolExecutor) {
    super(config, toolExecutor);
    const OpenAI = require('openai');
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
  }

  private convertTools(tools: MCPTool[]): any[] {
    return tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  async chatStream(messages: Message[], onEvent: (event: StreamEvent) => void): Promise<void> {
    const tools = this.toolExecutor.getToolDefinitions();
    let conversation: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string }> = [];

    // 构建初始消息
    let systemContent = '';
    for (const m of messages) {
      if (m.role === 'system') {
        systemContent += m.content + '\n';
      } else {
        conversation.push({ role: m.role, content: m.content });
      }
    }
    if (systemContent) {
      conversation.unshift({ role: 'system', content: systemContent.trim() });
    }

    const convertedTools = this.convertTools(tools);

    // 循环处理：AI 可能多次调工具
    let maxRounds = 10;
    while (maxRounds-- > 0) {
      const stream = await this.client.chat.completions.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens || 4096,
        temperature: this.config.temperature ?? 0.3,
        messages: conversation as any[],
        tools: convertedTools,
        stream: true,
      });

      let toolCallId = '';
      let toolCallName = '';
      let toolCallArgs = '';
      let hadToolCall = false;
      let finishReason: string | null = null;

      for await (const chunk of stream) {
        finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          onEvent({ type: 'text', content: delta.content });
        }

        if (delta.tool_calls) {
          hadToolCall = true;
          for (const tc of delta.tool_calls) {
            if (tc.function?.name) toolCallName += tc.function.name;
            if (tc.function?.arguments) toolCallArgs += tc.function.arguments;
            if (tc.id) toolCallId = tc.id;
          }
        }
      }

      if (finishReason === 'tool_calls' && hadToolCall) {
        // 解析并执行工具
        let inputObj: Record<string, unknown> = {};
        try { inputObj = JSON.parse(toolCallArgs); } catch { /* ignore */ }

        const call: ToolCall = { id: toolCallId, name: toolCallName, arguments: inputObj };
        onEvent({ type: 'tool_call', call });

        const result = await this.toolExecutor.execute(call);
        onEvent({ type: 'tool_result', result });

        // 把 AI 的工具调用和工具结果加回对话，让 AI 继续
        conversation.push({
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: toolCallId,
            type: 'function',
            function: { name: toolCallName, arguments: toolCallArgs },
          }],
        } as any);
        conversation.push({
          role: 'tool',
          content: result.success ? result.output : `错误: ${result.error}`,
          tool_call_id: toolCallId,
        });

        // 重新发请求
        toolCallId = '';
        toolCallName = '';
        toolCallArgs = '';
        continue;
      }

      // finish_reason === 'stop' 或其他情况，结束
      onEvent({ type: 'done' });
      return;
    }

    // 达到最大轮次
    onEvent({ type: 'error', error: '工具调用轮次过多，已停止' });
  }
}

// ==================== 提供者工厂 ====================

export function createProvider(
  config: ModelConfig,
  toolExecutor: MCPToolExecutor
): AIProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config, toolExecutor);
    case 'openai':
    case 'custom':
      return new OpenAIProvider(config, toolExecutor);
    default:
      throw new Error(`不支持的模型提供商: ${config.provider}`);
  }
}
