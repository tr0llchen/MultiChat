import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorText } from '../api';
import type { User, UserRow } from '../api';
import { useAuth } from '../auth';

export function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api<UserRow[]>('GET', '/users').then(setUsers, (err) => setError(errorText(err)));
  }, []);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>, done?: string) {
    setError('');
    setNotice('');
    try {
      await fn();
      if (done) setNotice(done);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  function resetPassword(u: UserRow) {
    const password = window.prompt(`New password for ${u.username} (at least 8 characters):`);
    if (password === null) return;
    void act(
      () => api('PATCH', `/users/${u.id}`, { password }),
      `The password of ${u.username} was changed. They are signed out everywhere.`,
    );
  }

  function remove(u: UserRow) {
    if (window.confirm(`Delete ${u.username} and all their discussions? This cannot be undone.`)) {
      void act(() => api('DELETE', `/users/${u.id}`));
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">Users</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Accounts are local to this installation. Each user sees only their own discussions.
        </p>
      </div>

      <AddUser onAdded={load} />

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </p>
      )}
      {!users && !error && <p className="text-sm text-slate-500">Loading…</p>}
      {users && (
        <ul className="card divide-y divide-slate-200 !p-0 dark:divide-slate-800">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {u.username}
                  {u.id === me?.id && <span className="font-normal text-slate-500"> (you)</span>}
                </p>
                <p className="text-xs text-slate-500">
                  {u.role === 'admin' ? 'Administrator' : 'User'} · added {new Date(u.createdAt).toLocaleDateString()}
                </p>
              </div>
              {u.id !== me?.id && (
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn btn-secondary"
                    onClick={() => void act(() => api('PATCH', `/users/${u.id}`, { role: u.role === 'admin' ? 'user' : 'admin' }))}
                  >
                    {u.role === 'admin' ? 'Make user' : 'Make administrator'}
                  </button>
                  <button className="btn btn-secondary" onClick={() => resetPassword(u)}>
                    Reset password
                  </button>
                  <button className="btn btn-danger" onClick={() => remove(u)}>
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddUser({ onAdded }: { onAdded(): void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<User['role']>('user');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('POST', '/users', { username: username.trim(), password, role });
      setUsername('');
      setPassword('');
      setRole('user');
      onAdded();
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <h2 className="font-medium">Add user</h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_10rem]">
        <div>
          <label className="label" htmlFor="new-username">
            Username
          </label>
          <input
            id="new-username"
            className="input"
            required
            pattern="[A-Za-z0-9._\-]{2,32}"
            title="2–32 characters: letters, digits, dot, dash or underscore"
            autoComplete="off"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="new-password">
            Password
          </label>
          <input
            id="new-password"
            type="password"
            className="input"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="new-role">
            Role
          </label>
          <select id="new-role" className="input" value={role} onChange={(e) => setRole(e.target.value as User['role'])}>
            <option value="user">User</option>
            <option value="admin">Administrator</option>
          </select>
        </div>
      </div>
      <p className="text-xs text-slate-500">Administrators can also manage providers, models and users.</p>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <button className="btn btn-primary" disabled={busy}>
        Add user
      </button>
    </form>
  );
}
