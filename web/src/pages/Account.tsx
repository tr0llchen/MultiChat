import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorText } from '../api';
import { useAuth } from '../auth';

export function Account() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setDone(false);
    try {
      await api('POST', '/auth/password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">Account</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Signed in as {user?.username} ({user?.role === 'admin' ? 'administrator' : 'user'}).
        </p>
      </div>
      <form onSubmit={submit} className="card space-y-4">
        <h2 className="font-medium">Change password</h2>
        {/* Lets password managers attach the new password to the right account. */}
        <input type="text" name="username" autoComplete="username" value={user?.username ?? ''} readOnly hidden />
        <div>
          <label className="label" htmlFor="current-password">
            Current password
          </label>
          <input
            id="current-password"
            type="password"
            className="input"
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="new-password">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            className="input"
            required
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">At least 8 characters. Other browsers and devices will be signed out.</p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {done && (
          <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
            Your password was changed.
          </p>
        )}
        <button className="btn btn-primary" disabled={busy}>
          Change password
        </button>
      </form>
    </div>
  );
}
