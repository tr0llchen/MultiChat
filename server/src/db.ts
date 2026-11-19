import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','user')),
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE providers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('openai','anthropic')),
    base_url TEXT NOT NULL,
    api_key_enc TEXT,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE TABLE models (
    id INTEGER PRIMARY KEY,
    provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    UNIQUE (provider_id, model_id)
  );
  CREATE TABLE discussions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('free','round_robin')),
    max_rounds INTEGER NOT NULL DEFAULT 3,
    created_at TEXT NOT NULL DEFAULT ${NOW},
    updated_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX discussions_user ON discussions (user_id, updated_at);
  CREATE TABLE participants (
    id INTEGER PRIMARY KEY,
    discussion_id INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
    -- NULL when the model or its provider was deleted later.
    model_ref INTEGER REFERENCES models(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    model_label TEXT NOT NULL,
    role_prompt TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL
  );
  CREATE INDEX participants_discussion ON participants (discussion_id, position);
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    discussion_id INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
    -- NULL means the message was written by the human user.
    participant_id INTEGER REFERENCES participants(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('complete','streaming','stopped','error','passed')),
    error TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX messages_discussion ON messages (discussion_id, id);
  `,
];

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // Replies that were mid-stream when the server last stopped can never finish.
  db.exec(`UPDATE messages SET status = 'stopped' WHERE status = 'streaming'`);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  return db;
}

/** Runs fn inside a transaction and returns its result. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
