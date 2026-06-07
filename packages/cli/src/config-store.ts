import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ModelConfig } from '@ai-cli/shared';

const GLOBAL_CONFIG = path.join(os.homedir(), '.ai-cli.json');
const PROJECT_CONFIGS = ['.ai-cli.json', '.ai-cli.config.json'];

function readConfig(): ModelConfig | null {
  // 优先级：项目配置 > 全局配置
  let dir = process.cwd();
  while (dir) {
    for (const name of PROJECT_CONFIGS) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) {
        try {
          const data = fs.readFileSync(p, 'utf-8');
          const config = JSON.parse(data) as ModelConfig;
          if (config.apiKey) return config;
        } catch { /* ignore */ }
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 全局配置
  if (fs.existsSync(GLOBAL_CONFIG)) {
    try {
      const data = fs.readFileSync(GLOBAL_CONFIG, 'utf-8');
      return JSON.parse(data) as ModelConfig;
    } catch { /* ignore */ }
  }
  return null;
}

function writeConfig(config: ModelConfig, toProject = false): string {
  const filePath = toProject
    ? path.join(process.cwd(), '.ai-cli.json')
    : GLOBAL_CONFIG;
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  return filePath;
}

function getConfigPath(): string {
  return GLOBAL_CONFIG;
}

export { readConfig, writeConfig, getConfigPath };
