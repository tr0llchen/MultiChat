import { ProviderError } from './types.ts';

export interface SseEvent {
  event: string;
  data: string;
}

/** Parses a text/event-stream response body into events. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];

  function* takeLines(final: boolean): Generator<SseEvent> {
    for (;;) {
      const nl = buffer.indexOf('\n');
      let line: string;
      if (nl === -1) {
        if (!final || buffer === '') return;
        line = buffer;
        buffer = '';
      } else {
        line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
      }
      if (line.endsWith('\r')) line = line.slice(0, -1);

      if (line === '') {
        if (data.length > 0) yield { event: event || 'message', data: data.join('\n') };
        event = '';
        data = [];
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
      } else if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      }
    }
  }

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    yield* takeLines(false);
  }
  buffer += decoder.decode();
  yield* takeLines(true);
  if (data.length > 0) yield { event: event || 'message', data: data.join('\n') };
}

/** fetch that turns network failures and non-2xx responses into ProviderError. */
export async function request(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (init.signal?.aborted) throw err;
    throw new ProviderError(`Could not reach ${new URL(url).origin}${failureReason(err)}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(`${res.status} ${errorMessage(text) || res.statusText}`.trim(), res.status);
  }
  return res;
}

/** Describes why a connection failed, for example " (ECONNREFUSED)". Empty when nothing useful is known. */
function failureReason(err: unknown): string {
  const cause = err instanceof Error ? err.cause : undefined;
  if (!(cause instanceof Error)) return '';
  const code = (cause as NodeJS.ErrnoException).code;
  const reason = typeof code === 'string' && code ? code : cause.message;
  return reason ? ` (${reason})` : '';
}

/** Extracts the message from the JSON error shapes used by OpenAI-compatible and Anthropic APIs. */
export function errorMessage(text: string): string {
  try {
    const json = JSON.parse(text) as { error?: unknown; message?: unknown };
    const err = json.error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
      return (err as { message: string }).message;
    }
    if (typeof json.message === 'string') return json.message;
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return text.slice(0, 300);
}

export function trimSlashes(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
