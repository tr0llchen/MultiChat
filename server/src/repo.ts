import type { Db } from './db.ts';

export type Mode = 'free' | 'round_robin';
export type MessageStatus = 'complete' | 'streaming' | 'stopped' | 'error' | 'passed';

export interface Discussion {
  id: number;
  userId: number;
  title: string;
  mode: Mode;
  maxRounds: number;
  createdAt: string;
  updatedAt: string;
}

export interface Participant {
  id: number;
  discussionId: number;
  modelRef: number | null;
  name: string;
  modelLabel: string;
  rolePrompt: string;
  position: number;
}

export interface Message {
  id: number;
  discussionId: number;
  /** null for messages written by the human user. */
  participantId: number | null;
  content: string;
  status: MessageStatus;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
}

const DISCUSSION_COLS = `id, user_id AS userId, title, mode, max_rounds AS maxRounds,
  created_at AS createdAt, updated_at AS updatedAt`;
const PARTICIPANT_COLS = `id, discussion_id AS discussionId, model_ref AS modelRef, name,
  model_label AS modelLabel, role_prompt AS rolePrompt, position`;
const MESSAGE_COLS = `id, discussion_id AS discussionId, participant_id AS participantId, content,
  status, error, input_tokens AS inputTokens, output_tokens AS outputTokens, created_at AS createdAt`;

export function getDiscussion(db: Db, id: number): Discussion | undefined {
  return db.prepare(`SELECT ${DISCUSSION_COLS} FROM discussions WHERE id = ?`).get(id) as Discussion | undefined;
}

export function listDiscussions(db: Db, userId: number): Discussion[] {
  return db
    .prepare(`SELECT ${DISCUSSION_COLS} FROM discussions WHERE user_id = ? ORDER BY updated_at DESC, id DESC`)
    .all(userId) as unknown as Discussion[];
}

export function listParticipants(db: Db, discussionId: number): Participant[] {
  return db
    .prepare(`SELECT ${PARTICIPANT_COLS} FROM participants WHERE discussion_id = ? ORDER BY position, id`)
    .all(discussionId) as unknown as Participant[];
}

export function listMessages(db: Db, discussionId: number): Message[] {
  return db
    .prepare(`SELECT ${MESSAGE_COLS} FROM messages WHERE discussion_id = ? ORDER BY id`)
    .all(discussionId) as unknown as Message[];
}

export function getMessage(db: Db, id: number): Message {
  return db.prepare(`SELECT ${MESSAGE_COLS} FROM messages WHERE id = ?`).get(id) as unknown as Message;
}

export function insertMessage(
  db: Db,
  discussionId: number,
  participantId: number | null,
  content: string,
  status: MessageStatus,
): Message {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO messages (discussion_id, participant_id, content, status) VALUES (?, ?, ?, ?)')
    .run(discussionId, participantId, content, status);
  db.prepare(`UPDATE discussions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(discussionId);
  return getMessage(db, Number(lastInsertRowid));
}

export interface ModelTarget {
  modelId: string;
  enabled: number;
  type: 'openai' | 'anthropic';
  baseUrl: string;
  apiKeyEnc: string | null;
}

/** Resolves the model and provider a participant talks to. */
export function getModelTarget(db: Db, modelRef: number): ModelTarget | undefined {
  return db
    .prepare(
      `SELECT m.model_id AS modelId, m.enabled, p.type, p.base_url AS baseUrl, p.api_key_enc AS apiKeyEnc
       FROM models m JOIN providers p ON p.id = m.provider_id WHERE m.id = ?`,
    )
    .get(modelRef) as ModelTarget | undefined;
}
