import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import Markdown from 'react-markdown';
import { useNavigate, useParams } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { api, errorText } from '../api';
import type { DiscussionDetail, DiscussionSummary, EngineEvent, Message, Mode, Participant } from '../api';
import { useDiscussions } from '../discussions';

const COLORS = [
  'text-emerald-700 dark:text-emerald-400',
  'text-sky-700 dark:text-sky-400',
  'text-amber-700 dark:text-amber-400',
  'text-fuchsia-700 dark:text-fuchsia-400',
  'text-rose-700 dark:text-rose-400',
  'text-teal-700 dark:text-teal-400',
  'text-violet-700 dark:text-violet-400',
  'text-orange-700 dark:text-orange-400',
];

function colorOf(participant: Participant): string {
  return COLORS[participant.position % COLORS.length]!;
}

export function Discussion() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { refresh } = useDiscussions();
  const [detail, setDetail] = useState<DiscussionDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Follow new text only while the reader is at the bottom, so scrolling up to read is not interrupted.
  const stickToBottom = useRef(true);

  useEffect(() => {
    setDetail(null);
    setMessages([]);
    setRunning(false);
    setConnected(true);
    setLoadError('');
    setActionError('');
    setShowSettings(false);
    setText('');
    stickToBottom.current = true;

    let cancelled = false;
    let gotInit = false;
    api<DiscussionDetail>('GET', `/discussions/${id}`).then(
      (d) => {
        if (cancelled) return;
        setDetail(d);
        // The event stream is the source of truth once it has delivered the transcript.
        if (!gotInit) {
          setMessages(d.messages);
          setRunning(d.running);
        }
      },
      (err) => !cancelled && setLoadError(errorText(err)),
    );

    const events = new EventSource(`/api/discussions/${id}/events`);
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.onmessage = (e) => {
      const ev = JSON.parse(e.data as string) as EngineEvent;
      if (ev.type === 'init') {
        gotInit = true;
        setMessages(ev.messages);
        setRunning(ev.running);
      } else if (ev.type === 'message') {
        setMessages((ms) => {
          const at = ms.findIndex((m) => m.id === ev.message.id);
          if (at === -1) return [...ms, ev.message];
          const copy = ms.slice();
          copy[at] = ev.message;
          return copy;
        });
      } else if (ev.type === 'delta') {
        setMessages((ms) => ms.map((m) => (m.id === ev.id ? { ...m, content: m.content + ev.text } : m)));
      } else {
        setRunning(ev.running);
        // Activity moves the discussion to the top of the sidebar.
        if (!ev.running) refresh();
      }
    };
    return () => {
      cancelled = true;
      events.close();
    };
  }, [id, refresh]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [messages]);

  function onScroll() {
    const list = listRef.current;
    if (list) stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  }

  async function act(fn: () => Promise<unknown>) {
    setActionError('');
    try {
      await fn();
    } catch (err) {
      setActionError(errorText(err));
    }
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    stickToBottom.current = true;
    await act(async () => {
      await api('POST', `/discussions/${id}/messages`, { content });
      setText('');
    });
    setSending(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  function mention(name: string) {
    setText((t) => `${t}${t && !/\s$/.test(t) ? ' ' : ''}@${name} `);
    inputRef.current?.focus();
  }

  if (loadError) return <p className="p-6 text-sm text-red-600 dark:text-red-400">{loadError}</p>;
  if (!detail) return <p className="p-6 text-sm text-slate-500">Loading…</p>;

  const byId = new Map(detail.participants.map((p) => [p.id, p]));

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-4xl items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-semibold" title={detail.title}>
              {detail.title}
            </h1>
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm">
              {detail.participants.map((p) => (
                <span key={p.id} className={colorOf(p)} title={[p.modelLabel, p.rolePrompt].filter(Boolean).join('\n')}>
                  ● {p.name}
                </span>
              ))}
            </p>
          </div>
          <button className="btn btn-secondary shrink-0" onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings}>
            Settings
          </button>
        </div>
        {showSettings && (
          <Settings
            detail={detail}
            onSaved={(d) => {
              setDetail({ ...detail, ...d });
              setShowSettings(false);
              refresh();
            }}
            onDeleted={() => {
              refresh();
              navigate('/');
            }}
          />
        )}
      </header>

      <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-4xl space-y-5">
          {messages.length === 0 && !running && (
            <p className="text-center text-sm text-slate-500">No messages yet. Write something to start.</p>
          )}
          {messages.map((m) => (
            <MessageView key={m.id} message={m} participant={m.participantId === null ? null : (byId.get(m.participantId) ?? null)} />
          ))}
        </div>
      </div>

      <footer className="border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <form onSubmit={send} className="mx-auto max-w-4xl space-y-2">
          {!connected && (
            <p className="text-sm text-amber-700 dark:text-amber-400">Connection lost. Trying to reconnect…</p>
          )}
          {actionError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {actionError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-slate-500">{running ? 'The models are discussing…' : 'Address one model:'}</span>
            {!running &&
              detail.participants.map((p) => (
                <button key={p.id} type="button" className={`cursor-pointer hover:underline ${colorOf(p)}`} onClick={() => mention(p.name)}>
                  @{p.name}
                </button>
              ))}
          </div>
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              className="input max-h-60 min-h-11 flex-1"
              rows={2}
              aria-label="Your message"
              placeholder={running ? 'Write a message to interrupt the models and step in.' : 'Write a message. Enter sends, Shift+Enter adds a line.'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              {running ? (
                <button type="button" className="btn btn-danger" onClick={() => void act(() => api('POST', `/discussions/${id}/stop`))}>
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary"
                  title="Let the models keep discussing without a new message from you"
                  onClick={() => {
                    stickToBottom.current = true;
                    void act(() => api('POST', `/discussions/${id}/continue`));
                  }}
                >
                  Continue
                </button>
              )}
              <button className="btn btn-primary" disabled={sending || !text.trim()}>
                Send
              </button>
            </div>
          </div>
        </form>
      </footer>
    </div>
  );
}

const MessageView = memo(function MessageView({ message, participant }: { message: Message; participant: Participant | null }) {
  if (!participant) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2.5 text-sm whitespace-pre-wrap text-white [overflow-wrap:anywhere]">
          {message.content}
        </div>
      </div>
    );
  }

  const color = colorOf(participant);
  if (message.status === 'passed') {
    return (
      <p className="text-sm text-slate-500">
        <span className={color}>{participant.name}</span> had nothing to add.
      </p>
    );
  }

  const tokens = [
    message.inputTokens !== null && `${message.inputTokens.toLocaleString()} tokens in`,
    message.outputTokens !== null && `${message.outputTokens.toLocaleString()} out`,
  ].filter(Boolean);

  return (
    <article>
      <p className="mb-1 flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className={`font-semibold ${color}`}>{participant.name}</span>
        <span className="text-xs text-slate-500">{participant.modelLabel}</span>
        {message.status === 'stopped' && (
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">Stopped</span>
        )}
      </p>
      {message.content && (
        <div className="prose prose-sm prose-slate dark:prose-invert max-w-none [overflow-wrap:anywhere] prose-pre:overflow-x-auto">
          <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
        </div>
      )}
      {message.status === 'streaming' && (
        <p className="mt-1 animate-pulse text-sm text-slate-500">{message.content ? 'Writing…' : 'Thinking…'}</p>
      )}
      {message.status === 'error' && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          No reply: {message.error ?? 'unknown error'}
        </p>
      )}
      {tokens.length > 0 && <p className="mt-1 text-xs text-slate-400">{tokens.join(' · ')}</p>}
    </article>
  );
});

function Settings({
  detail,
  onSaved,
  onDeleted,
}: {
  detail: DiscussionDetail;
  onSaved(d: DiscussionSummary): void;
  onDeleted(): void;
}) {
  const [title, setTitle] = useState(detail.title);
  const [mode, setMode] = useState<Mode>(detail.mode);
  const [maxRounds, setMaxRounds] = useState(detail.maxRounds);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSaved(await api<DiscussionSummary>('PATCH', `/discussions/${detail.id}`, { title: title.trim(), mode, maxRounds }));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${detail.title}" and all its messages? This cannot be undone.`)) return;
    setBusy(true);
    setError('');
    try {
      await api('DELETE', `/discussions/${detail.id}`);
      onDeleted();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mx-auto mt-3 max-w-4xl space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
      <div className="grid gap-3 sm:grid-cols-[1fr_16rem_8rem]">
        <div>
          <label className="label" htmlFor="settings-title">
            Topic
          </label>
          <input id="settings-title" className="input" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="settings-mode">
            After each of your messages
          </label>
          <select id="settings-mode" className="input" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="round_robin">Models discuss with each other</option>
            <option value="free">Each model replies once</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="settings-rounds">
            Rounds, at most
          </label>
          <input
            id="settings-rounds"
            type="number"
            className="input"
            min={1}
            max={10}
            required
            disabled={mode === 'free'}
            value={maxRounds}
            onChange={(e) => setMaxRounds(Number(e.target.value))}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-between gap-2">
        <button className="btn btn-primary" disabled={busy}>
          Save
        </button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void remove()}>
          Delete discussion
        </button>
      </div>
    </form>
  );
}
