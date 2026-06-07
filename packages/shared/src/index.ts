export * from './types';
import { Message, Conversation } from './types';

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createConversation(messages: Message[] = []): Conversation {
  const now = Date.now();
  return {
    id: generateId(),
    messages,
    createdAt: now,
    updatedAt: now,
  };
}
