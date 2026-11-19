import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorText } from '../api';
import type { AvailableModel, Provider, ProviderType } from '../api';

const TYPE_LABEL: Record<ProviderType, string> = {
  openai: 'OpenAI-compatible',
  anthropic: 'Anthropic',
};
const DEFAULT_URL: Record<ProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
};

export function Providers() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api<Provider[]>('GET', '/providers').then(
      (p) => {
        setProviders(p);
        setError('');
      },
      (err) => setError(errorText(err)),
    );
  }, []);
  useEffect(load, [load]);

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Providers and models</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Connect the APIs you have access to, then choose which of their models all users can add to discussions.
          </p>
        </div>
        {!adding && (
          <button className="btn btn-primary shrink-0" onClick={() => setAdding(true)}>
            Add provider
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {adding && (
        <ProviderForm
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}
      {!providers && !error && <p className="text-sm text-slate-500">Loading…</p>}
      {providers?.length === 0 && !adding && (
        <p className="card text-center text-sm text-slate-500">
          No providers yet. Add one to get started, for example OpenAI, Anthropic, OpenRouter or a local Ollama server.
        </p>
      )}
      {providers?.map((p) => <ProviderCard key={p.id} provider={p} onChanged={load} />)}
    </div>
  );
}

function ProviderForm({ provider, onSaved, onCancel }: { provider?: Provider; onSaved(): void; onCancel(): void }) {
  const [name, setName] = useState(provider?.name ?? '');
  const [type, setType] = useState<ProviderType>(provider?.type ?? 'openai');
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (provider) {
        await api('PATCH', `/providers/${provider.id}`, {
          name: name.trim(),
          baseUrl: baseUrl.trim() || DEFAULT_URL[provider.type],
          // Leaving the field empty keeps the stored key.
          ...(removeKey ? { apiKey: null } : apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        });
      } else {
        await api('POST', '/providers', { name: name.trim(), type, baseUrl: baseUrl.trim(), apiKey: apiKey.trim() });
      }
      onSaved();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const prefix = provider ? `provider-${provider.id}` : 'provider-new';
  return (
    <form onSubmit={submit} className="card space-y-4">
      <h2 className="font-medium">{provider ? `Edit ${provider.name}` : 'Add provider'}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${prefix}-name`}>
            Name
          </label>
          <input
            id={`${prefix}-name`}
            className="input"
            required
            maxLength={60}
            autoFocus
            placeholder="For example: OpenAI"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor={`${prefix}-type`}>
            API type
          </label>
          <select
            id={`${prefix}-type`}
            className="input"
            disabled={!!provider}
            value={type}
            onChange={(e) => setType(e.target.value as ProviderType)}
          >
            <option value="openai">OpenAI-compatible (OpenAI, OpenRouter, Ollama, Mistral, Groq, …)</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`${prefix}-url`}>
          Base URL
        </label>
        <input
          id={`${prefix}-url`}
          className="input"
          type="url"
          maxLength={500}
          placeholder={DEFAULT_URL[type]}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-500">
          {type === 'openai'
            ? 'Leave empty for OpenAI. For other services, enter the URL that ends in /v1, for example http://host.docker.internal:11434/v1 for Ollama on this machine.'
            : 'Leave empty to use Anthropic directly.'}
        </p>
      </div>
      <div>
        <label className="label" htmlFor={`${prefix}-key`}>
          API key
        </label>
        <input
          id={`${prefix}-key`}
          className="input"
          type="password"
          autoComplete="off"
          maxLength={2000}
          disabled={removeKey}
          placeholder={provider?.hasApiKey ? 'A key is saved. Enter a new one to replace it.' : 'Leave empty if the server needs no key'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        {provider?.hasApiKey ? (
          <label className="mt-1.5 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={removeKey} onChange={(e) => setRemoveKey(e.target.checked)} />
            Remove the saved key
          </label>
        ) : (
          <p className="mt-1 text-xs text-slate-500">The key is stored encrypted and is never shown again.</p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy}>
          {provider ? 'Save' : 'Add provider'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ProviderCard({ provider, onChanged }: { provider: Provider; onChanged(): void }) {
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(provider.models.length === 0);
  const [error, setError] = useState('');

  async function act(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }

  function remove() {
    const warning = provider.models.length
      ? ` Its ${provider.models.length} model(s) will stop working in existing discussions.`
      : '';
    if (window.confirm(`Delete the provider "${provider.name}"?${warning}`)) {
      void act(() => api('DELETE', `/providers/${provider.id}`));
    }
  }

  if (editing) {
    return (
      <ProviderForm
        provider={provider}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onChanged();
        }}
      />
    );
  }

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-medium">{provider.name}</h2>
          <p className="truncate text-sm text-slate-500 dark:text-slate-400">
            {TYPE_LABEL[provider.type]} · {provider.baseUrl} · {provider.hasApiKey ? 'API key saved' : 'no API key'}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button className="btn btn-danger" onClick={remove}>
            Delete
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {provider.models.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {provider.models.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <label className="flex min-w-0 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={m.enabled}
                  onChange={(e) => void act(() => api('PATCH', `/models/${m.id}`, { enabled: e.target.checked }))}
                />
                <span className="min-w-0">
                  <span className={`block truncate text-sm ${m.enabled ? '' : 'text-slate-400 line-through'}`}>{m.displayName}</span>
                  {m.displayName !== m.modelId && <span className="block truncate text-xs text-slate-500">{m.modelId}</span>}
                </span>
              </label>
              <button
                className="cursor-pointer text-sm text-slate-500 hover:text-red-600"
                onClick={() => {
                  if (window.confirm(`Remove "${m.displayName}"? It will stop working in existing discussions.`)) {
                    void act(() => api('DELETE', `/models/${m.id}`));
                  }
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {provider.models.length > 0 && (
        <p className="text-xs text-slate-500">Unticked models stay in existing discussions but cannot reply or be added to new ones.</p>
      )}

      {picking ? (
        <ModelPicker
          provider={provider}
          onClose={() => setPicking(false)}
          onAdded={() => {
            setPicking(false);
            onChanged();
          }}
        />
      ) : (
        <button className="btn btn-secondary" onClick={() => setPicking(true)}>
          Add models
        </button>
      )}
    </section>
  );
}

/** Lists the models the provider offers, so the admin can tick the ones to add. */
function ModelPicker({ provider, onAdded, onClose }: { provider: Provider; onAdded(): void; onClose(): void }) {
  const [available, setAvailable] = useState<AvailableModel[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [manual, setManual] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setAvailable(null);
    setLoadError('');
    api<AvailableModel[]>('GET', `/providers/${provider.id}/available-models`).then(setAvailable, (err) =>
      setLoadError(errorText(err)),
    );
  }, [provider.id]);
  useEffect(load, [load]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const names = new Map(available?.map((m) => [m.id, m.name]));
    const models = [...selected].map((id) => ({ id, name: names.get(id) ?? id }));
    if (manual.trim()) models.push({ id: manual.trim(), name: manual.trim() });
    if (models.length === 0) return;
    setBusy(true);
    setError('');
    try {
      await api('POST', `/providers/${provider.id}/models`, { models });
      onAdded();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const query = filter.trim().toLowerCase();
  const shown = available?.filter((m) => !query || m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query));
  const count = selected.size + (manual.trim() ? 1 : 0);

  return (
    <form onSubmit={add} className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <h3 className="text-sm font-medium">Add models from {provider.name}</h3>

      {!available && !loadError && <p className="text-sm text-slate-500">Loading the model list…</p>}
      {loadError && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {loadError}
          </p>
          <p className="text-sm text-slate-500">Check the base URL and API key, or enter a model ID by hand below.</p>
          <button type="button" className="btn btn-secondary" onClick={load}>
            Try again
          </button>
        </div>
      )}
      {available && (
        <>
          {available.length > 8 && (
            <input
              className="input"
              type="search"
              aria-label="Filter models"
              placeholder={`Filter ${available.length} models`}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
          {available.length === 0 && <p className="text-sm text-slate-500">The provider did not list any models.</p>}
          <ul className="max-h-72 space-y-0.5 overflow-y-auto">
            {shown?.map((m) => (
              <li key={m.id}>
                <label className={`flex items-center gap-3 rounded px-2 py-1 text-sm ${m.added ? 'text-slate-400' : 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                  <input type="checkbox" disabled={m.added} checked={m.added || selected.has(m.id)} onChange={() => toggle(m.id)} />
                  <span className="min-w-0 truncate">
                    {m.name}
                    {m.name !== m.id && <span className="text-slate-500"> · {m.id}</span>}
                    {m.added && ' (already added)'}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {shown?.length === 0 && available.length > 0 && <p className="text-sm text-slate-500">No model matches the filter.</p>}
        </>
      )}

      <div>
        <label className="label" htmlFor={`manual-${provider.id}`}>
          Or enter a model ID <span className="font-normal text-slate-500">(if it is not in the list)</span>
        </label>
        <input id={`manual-${provider.id}`} className="input" maxLength={200} value={manual} onChange={(e) => setManual(e.target.value)} />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy || count === 0}>
          {count === 0 ? 'Add models' : `Add ${count} model${count === 1 ? '' : 's'}`}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
