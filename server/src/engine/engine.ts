import type { Vault } from '../crypto.ts';
import type { Db } from '../db.ts';
import { ProviderError } from '../providers/types.ts';
import type { AdapterFactory } from '../providers/index.ts';
import { getMessage, getModelTarget, insertMessage, listMessages, listParticipants } from '../repo.ts';
import type { Discussion, Message, MessageStatus, Participant } from '../repo.ts';
import { buildMessages, buildSystemPrompt, couldBePass, findMentions, isPass } from './prompt.ts';

export type EngineEvent =
  /** Sent once to every new subscriber: the full transcript, including the reply in progress. */
  | { type: 'init'; messages: Message[]; running: boolean }
  /** A message was created or reached its final state. */
  | { type: 'message'; message: Message }
  | { type: 'delta'; id: number; text: string }
  | { type: 'run'; running: boolean };

export type Listener = (event: EngineEvent) => void;

export interface EngineDeps {
  db: Db;
  vault: Vault;
  createAdapter: AdapterFactory;
  maxOutputTokens: number;
  turnTimeoutMs?: number;
}

interface LiveReply {
  id: number;
  content: string;
  /** How much of content was sent to subscribers. Text that may still become a pass is held back. */
  shown: number;
}

interface Run {
  controller: AbortController;
  live: LiveReply | null;
  done: Promise<void>;
}

/** Runs discussions: decides who speaks next, calls the models and streams the replies to subscribers. */
export class Engine {
  private readonly deps: EngineDeps;
  private readonly runs = new Map<number, Run>();
  private readonly listeners = new Map<number, Set<Listener>>();

  constructor(deps: EngineDeps) {
    this.deps = deps;
  }

  isRunning(discussionId: number): boolean {
    return this.runs.has(discussionId);
  }

  subscribe(discussionId: number, listener: Listener): () => void {
    const live = this.runs.get(discussionId)?.live;
    const messages = listMessages(this.deps.db, discussionId).map((m) =>
      live && m.id === live.id ? { ...m, content: live.content.slice(0, live.shown) } : m,
    );
    listener({ type: 'init', messages, running: this.isRunning(discussionId) });

    let set = this.listeners.get(discussionId);
    if (!set) this.listeners.set(discussionId, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(discussionId);
    };
  }

  /** Stops the run in progress, if any, and waits until its last reply is saved. */
  async stop(discussionId: number): Promise<void> {
    // Loop, because another request may start a new run while we wait.
    for (let run = this.runs.get(discussionId); run; run = this.runs.get(discussionId)) {
      run.controller.abort();
      await run.done;
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.runs.keys()].map((id) => this.stop(id)));
  }

  /**
   * Starts a run, interrupting the one in progress. With a user message, the
   * models reply to it; without one, they continue discussing among themselves.
   */
  async begin(discussion: Discussion, userName: string, userMessage: string | null): Promise<void> {
    const { db } = this.deps;
    await this.stop(discussion.id);
    // No awaits from here until the run is registered, so two requests cannot both start one.

    const participants = listParticipants(db, discussion.id);
    let addressed: Participant[] | null = null;
    if (userMessage !== null) {
      const message = insertMessage(db, discussion.id, null, userMessage, 'complete');
      this.emit(discussion.id, { type: 'message', message });
      const mentioned = new Set(findMentions(userMessage, participants));
      if (mentioned.size > 0) addressed = participants.filter((p) => mentioned.has(p.id));
    }
    if (participants.length === 0) return;

    const run: Run = { controller: new AbortController(), live: null, done: Promise.resolve() };
    this.runs.set(discussion.id, run);
    this.emit(discussion.id, { type: 'run', running: true });
    run.done = this.run(discussion, userName, run, participants, addressed)
      .catch((err) => console.error(`Discussion ${discussion.id} failed:`, err))
      .finally(() => {
        this.runs.delete(discussion.id);
        this.emit(discussion.id, { type: 'run', running: false });
      });
  }

  private async run(
    discussion: Discussion,
    userName: string,
    run: Run,
    participants: Participant[],
    addressed: Participant[] | null,
  ): Promise<void> {
    // Models addressed with @Name reply once and the others stay quiet. Otherwise everyone
    // takes part; with a single model there is nobody to discuss with, so one round is enough.
    const speakers = addressed ?? participants;
    const rounds = !addressed && discussion.mode === 'round_robin' && participants.length > 1 ? discussion.maxRounds : 1;
    // A model that failed is left out of the following rounds, so its error is not repeated every round.
    const failed = new Set<number>();
    for (let round = 0; round < rounds; round++) {
      let contributed = false;
      for (const speaker of speakers) {
        if (run.controller.signal.aborted) return;
        if (failed.has(speaker.id)) continue;
        const status = await this.turn(discussion, speaker, participants, userName, run);
        if (status === 'complete') contributed = true;
        else if (status === 'error') failed.add(speaker.id);
      }
      // Everyone passed or failed: the discussion has settled.
      if (!contributed) return;
    }
  }

  private async turn(
    discussion: Discussion,
    self: Participant,
    all: Participant[],
    userName: string,
    run: Run,
  ): Promise<MessageStatus> {
    const { db, vault } = this.deps;
    const discussionId = discussion.id;
    const transcript = listMessages(db, discussionId);
    const message = insertMessage(db, discussionId, self.id, '', 'streaming');
    const live: LiveReply = { id: message.id, content: '', shown: 0 };
    run.live = live;
    this.emit(discussionId, { type: 'message', message });

    let status: MessageStatus = 'complete';
    let error: string | null = null;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    const timeout = AbortSignal.timeout(this.deps.turnTimeoutMs ?? 10 * 60_000);

    try {
      const target = self.modelRef === null ? undefined : getModelTarget(db, self.modelRef);
      if (!target) throw new ProviderError('This model is no longer available because its provider was removed.');
      if (!target.enabled) throw new ProviderError('This model was disabled by an admin.');
      const adapter = this.deps.createAdapter({
        type: target.type,
        baseUrl: target.baseUrl,
        apiKey: target.apiKeyEnc ? vault.decrypt(target.apiKeyEnc) : null,
      });
      const stream = adapter.chat({
        model: target.modelId,
        system: buildSystemPrompt(self, all, userName, discussion.title),
        messages: buildMessages(self, all, transcript, userName),
        maxTokens: this.deps.maxOutputTokens,
        signal: AbortSignal.any([run.controller.signal, timeout]),
      });
      for await (const ev of stream) {
        if (ev.type === 'usage') {
          inputTokens = ev.inputTokens ?? inputTokens;
          outputTokens = ev.outputTokens ?? outputTokens;
          continue;
        }
        live.content += ev.text;
        if (!couldBePass(live.content)) {
          this.emit(discussionId, { type: 'delta', id: live.id, text: live.content.slice(live.shown) });
          live.shown = live.content.length;
        }
      }
      // Some servers end the stream quietly when the request is aborted.
      run.controller.signal.throwIfAborted();
      if (isPass(live.content)) status = 'passed';
      else if (!live.content.trim()) throw new ProviderError('The model returned an empty reply.');
    } catch (err) {
      if (run.controller.signal.aborted) {
        status = 'stopped';
      } else {
        status = 'error';
        error = timeout.aborted ? 'The model took too long to reply.' : err instanceof Error ? err.message : String(err);
      }
    }

    const content = status === 'passed' ? '' : status === 'complete' ? live.content : live.content.slice(0, live.shown);
    db.prepare(
      'UPDATE messages SET content = ?, status = ?, error = ?, input_tokens = ?, output_tokens = ? WHERE id = ?',
    ).run(content, status, error, inputTokens, outputTokens, message.id);
    run.live = null;
    this.emit(discussionId, { type: 'message', message: getMessage(db, message.id) });
    return status;
  }

  private emit(discussionId: number, event: EngineEvent): void {
    for (const listener of this.listeners.get(discussionId) ?? []) {
      try {
        listener(event);
      } catch (err) {
        console.error('Listener failed:', err);
      }
    }
  }
}
