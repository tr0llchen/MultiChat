import { anthropicAdapter } from './anthropic.ts';
import { openaiAdapter } from './openai.ts';
import type { ProviderAdapter, ProviderSettings, ProviderType } from './types.ts';

export * from './types.ts';

export const DEFAULT_BASE_URL: Record<ProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
};

export type AdapterFactory = (settings: ProviderSettings) => ProviderAdapter;

export const createAdapter: AdapterFactory = ({ type, baseUrl, apiKey }) =>
  type === 'anthropic' ? anthropicAdapter(baseUrl, apiKey) : openaiAdapter(baseUrl, apiKey);
