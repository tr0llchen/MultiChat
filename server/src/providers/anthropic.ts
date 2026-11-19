import { parseSse, request, trimSlashes } from './http.ts';
import { ProviderError } from './types.ts';
import type { ChatEvent, ChatRequest, ModelInfo, ProviderAdapter } from './types.ts';

interface StreamEvent {
  type?: string;
  message?: { usage?: { input_tokens?: number } };
  delta?: { type?: string; text?: string };
  usage?: { output_tokens?: number };
  error?: { message?: string };
}

interface ModelPage {
  data?: { id: string; display_name?: string }[];
  has_more?: boolean;
  last_id?: string | null;
}

/** Adapter for Anthropic's native Messages API. */
export function anthropicAdapter(baseUrl: string, apiKey: string | null): ProviderAdapter {
  const base = trimSlashes(baseUrl).replace(/\/v1$/, '');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (apiKey) headers['x-api-key'] = apiKey;

  return {
    async listModels(signal) {
      const models: ModelInfo[] = [];
      let after = '';
      for (let page = 0; page < 20; page++) {
        const url = `${base}/v1/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`;
        const res = await request(url, { headers, signal: signal ?? null });
        const json = (await res.json()) as ModelPage;
        for (const m of json.data ?? []) models.push({ id: m.id, name: m.display_name || m.id });
        if (!json.has_more || !json.last_id) break;
        after = json.last_id;
      }
      return models;
    },

    async *chat(req: ChatRequest): AsyncGenerator<ChatEvent> {
      const res = await request(`${base}/v1/messages`, {
        method: 'POST',
        headers,
        signal: req.signal,
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens,
          stream: true,
          system: req.system,
          messages: req.messages,
        }),
      });
      if (!res.body) throw new ProviderError('Provider returned an empty response');

      for await (const ev of parseSse(res.body)) {
        let data: StreamEvent;
        try {
          data = JSON.parse(ev.data) as StreamEvent;
        } catch {
          continue;
        }
        if (data.type === 'error') throw new ProviderError(data.error?.message ?? 'Provider error');
        if (data.type === 'message_start' && data.message?.usage?.input_tokens !== undefined) {
          yield { type: 'usage', inputTokens: data.message.usage.input_tokens };
        } else if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta' && data.delta.text) {
          yield { type: 'text', text: data.delta.text };
        } else if (data.type === 'message_delta' && data.usage?.output_tokens !== undefined) {
          yield { type: 'usage', outputTokens: data.usage.output_tokens };
        }
      }
    },
  };
}
