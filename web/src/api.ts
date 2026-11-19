export interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
}

export interface UserRow extends User {
  createdAt: string;
}

export type ProviderType = 'openai' | 'anthropic';

export interface ProviderModel {
  id: number;
  providerId: number;
  modelId: string;
  displayName: string;
  enabled: boolean;
}

export interface Provider {
  id: number;
  name: string;
  type: ProviderType;
  baseUrl: string;
  hasApiKey: boolean;
  models: ProviderModel[];
}

export interface AvailableModel {
  id: string;
  name: string;
  added: boolean;
}

/** A model that can be added to a discussion. */
export interface ModelOption {
  id: number;
  modelId: string;
  displayName: string;
  providerName: string;
}

export type Mode = 'free' | 'round_robin';
export type MessageStatus = 'complete' | 'streaming' | 'stopped' | 'error' | 'passed';

export interface DiscussionSummary {
  id: number;
  title: string;
  mode: Mode;
  maxRounds: number;
  createdAt: string;
  updatedAt: string;
}

export interface Participant {
  id: number;
  name: string;
  modelLabel: string;
  rolePrompt: string;
  position: number;
}

export interface Message {
  id: number;
  /** null for messages written by the human user. */
  participantId: number | null;
  content: string;
  status: MessageStatus;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
}

export interface DiscussionDetail extends DiscussionSummary {
  participants: Participant[];
  messages: Message[];
  running: boolean;
}

export type EngineEvent =
  | { type: 'init'; messages: Message[]; running: boolean }
  | { type: 'message'; message: Message }
  | { type: 'delta'; id: number; text: string }
  | { type: 'run'; running: boolean };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Fired when the server no longer accepts the session, so the app can show the sign-in page. */
export const SIGNED_OUT_EVENT = 'multichat:signed-out';

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    throw new ApiError(res.status, json?.error ?? `The request failed (${res.status}).`);
  }
  return json as T;
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}
