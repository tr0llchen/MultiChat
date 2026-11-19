export type ProviderType = 'openai' | 'anthropic';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  signal: AbortSignal;
}

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number };

export interface ModelInfo {
  id: string;
  name: string;
}

export interface ProviderAdapter {
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  chat(req: ChatRequest): AsyncGenerator<ChatEvent>;
}

export interface ProviderSettings {
  type: ProviderType;
  baseUrl: string;
  apiKey: string | null;
}

export class ProviderError extends Error {
  status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}
