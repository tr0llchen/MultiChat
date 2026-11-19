import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorText } from '../api';
import type { DiscussionDetail, Mode, ModelOption } from '../api';
import { useAuth } from '../auth';
import { useDiscussions } from '../discussions';

const MAX_PARTICIPANTS = 8;
const ROLE_SUGGESTIONS = [
  'Critic: look for mistakes, gaps and weak reasoning in what the others say.',
  "Devil's advocate: argue for the opposite position to test the consensus.",
  'Fact-checker: verify claims and point out anything stated without support.',
  'Pragmatist: focus on what is practical to do and what it costs.',
  'Summarizer: keep track of what was agreed and what is still open.',
];

interface Seat {
  key: number;
  model: ModelOption;
  name: string;
  rolePrompt: string;
}

let nextKey = 1;

export function NewDiscussion() {
  const { user } = useAuth();
  const { refresh } = useDiscussions();
  const navigate = useNavigate();
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [seats, setSeats] = useState<Seat[]>([]);
  const [mode, setMode] = useState<Mode>('round_robin');
  const [maxRounds, setMaxRounds] = useState(3);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<ModelOption[]>('GET', '/models').then(setModels, (err) => setLoadError(errorText(err)));
  }, []);

  function addSeat(model: ModelOption) {
    setSeats((s) => [...s, { key: nextKey++, model, name: '', rolePrompt: '' }]);
  }

  function updateSeat(key: number, patch: Partial<Seat>) {
    setSeats((s) => s.map((seat) => (seat.key === key ? { ...seat, ...patch } : seat)));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const created = await api<DiscussionDetail>('POST', '/discussions', {
        title: title.trim(),
        message: message.trim(),
        mode,
        maxRounds,
        participants: seats.map((s) => ({ modelId: s.model.id, name: s.name.trim(), rolePrompt: s.rolePrompt.trim() })),
      });
      refresh();
      navigate(`/d/${created.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  if (loadError) return <p className="p-6 text-sm text-red-600 dark:text-red-400">{loadError}</p>;
  if (!models) return <p className="p-6 text-sm text-slate-500">Loading…</p>;

  if (models.length === 0) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <div className="card text-center">
          <h1 className="text-lg font-semibold">No models yet</h1>
          {user?.role === 'admin' ? (
            <>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Add a provider and choose which of its models to use. Then you can start a discussion.
              </p>
              <Link to="/admin/providers" className="btn btn-primary mt-4">
                Add a provider
              </Link>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Ask an administrator to add models. Then you can start a discussion.
            </p>
          )}
        </div>
      </div>
    );
  }

  const providers = [...new Set(models.map((m) => m.providerName))];
  const full = seats.length >= MAX_PARTICIPANTS;

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <h1 className="text-xl font-semibold">New discussion</h1>

      <section className="card space-y-4">
        <div>
          <label className="label" htmlFor="title">
            Topic
          </label>
          <input
            id="title"
            className="input"
            required
            maxLength={200}
            autoFocus
            placeholder="What should be discussed?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="message">
            Your initial thoughts or request <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <textarea
            id="message"
            className="input min-h-28"
            placeholder="Context, your own view, or what you want from the models."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="font-medium">Participants</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Add the models that should take part. You can add a model more than once, for example with different roles.
          </p>
        </div>

        {providers.map((provider) => (
          <div key={provider}>
            <p className="mb-1.5 text-xs font-medium tracking-wide text-slate-500 uppercase">{provider}</p>
            <div className="flex flex-wrap gap-2">
              {models
                .filter((m) => m.providerName === provider)
                .map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="btn btn-secondary"
                    disabled={full}
                    onClick={() => addSeat(m)}
                    title={m.modelId}
                  >
                    + {m.displayName}
                  </button>
                ))}
            </div>
          </div>
        ))}

        {seats.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-700">
            No participants yet. Add at least one model above.
          </p>
        ) : (
          <ul className="space-y-2">
            {seats.map((seat) => (
              <li key={seat.key} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium">
                    {seat.model.displayName} <span className="font-normal text-slate-500">· {seat.model.providerName}</span>
                  </p>
                  <button
                    type="button"
                    className="cursor-pointer text-sm text-slate-500 hover:text-red-600"
                    onClick={() => setSeats((s) => s.filter((x) => x.key !== seat.key))}
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[12rem_1fr]">
                  <input
                    className="input"
                    aria-label={`Name for ${seat.model.displayName}`}
                    placeholder={`Name (default: ${seat.model.displayName})`}
                    maxLength={60}
                    value={seat.name}
                    onChange={(e) => updateSeat(seat.key, { name: e.target.value })}
                  />
                  <input
                    className="input"
                    aria-label={`Role for ${seat.model.displayName}`}
                    placeholder="Role (optional), for example: Critic"
                    list="role-suggestions"
                    maxLength={2000}
                    value={seat.rolePrompt}
                    onChange={(e) => updateSeat(seat.key, { rolePrompt: e.target.value })}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <datalist id="role-suggestions">
          {ROLE_SUGGESTIONS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        {full && <p className="text-sm text-slate-500">A discussion can have up to {MAX_PARTICIPANTS} participants.</p>}
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">How the models take turns</h2>
        <label className="flex cursor-pointer items-start gap-3">
          <input type="radio" className="mt-1" checked={mode === 'round_robin'} onChange={() => setMode('round_robin')} />
          <span>
            <span className="text-sm font-medium">Models discuss with each other</span>
            <span className="block text-sm text-slate-500 dark:text-slate-400">
              After each of your messages, the models take turns for several rounds and respond to one another. They
              stop early when nobody has anything to add.
            </span>
          </span>
        </label>
        {mode === 'round_robin' && (
          <label className="ml-7 flex items-center gap-2 text-sm">
            Rounds per message, at most
            <input
              type="number"
              className="input w-20"
              min={1}
              max={10}
              required
              value={maxRounds}
              onChange={(e) => setMaxRounds(Number(e.target.value))}
            />
          </label>
        )}
        <label className="flex cursor-pointer items-start gap-3">
          <input type="radio" className="mt-1" checked={mode === 'free'} onChange={() => setMode('free')} />
          <span>
            <span className="text-sm font-medium">Each model replies once</span>
            <span className="block text-sm text-slate-500 dark:text-slate-400">
              After each of your messages, every model replies once, in order. Each one sees the replies before it.
            </span>
          </span>
        </label>
        <p className="text-sm text-slate-500 dark:text-slate-400">You can change this later, and stop the models at any time.</p>
      </section>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <button className="btn btn-primary" disabled={busy || seats.length === 0}>
        {busy ? 'Starting…' : 'Start discussion'}
      </button>
    </form>
  );
}
