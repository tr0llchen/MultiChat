import { useState } from 'react';
import type { FormEvent } from 'react';
import { errorText } from '../api';
import { useAuth } from '../auth';

/** Sign-in form. On a fresh install it creates the first (admin) account instead. */
export function SignIn() {
  const { needsSetup, signIn, setup } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await (needsSetup ? setup : signIn)(username.trim(), password);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold">💬 Multichat</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {needsSetup
              ? 'Welcome. Create the administrator account to get started.'
              : 'Sign in to continue.'}
          </p>
        </div>
        <div>
          <label className="label" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          {needsSetup && (
            <p className="mt-1 text-xs text-slate-500">2–32 characters: letters, digits, dot, dash or underscore.</p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="input"
            autoComplete={needsSetup ? 'new-password' : 'current-password'}
            required
            minLength={needsSetup ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {needsSetup && <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <button className="btn btn-primary w-full" disabled={busy}>
          {needsSetup ? 'Create account' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
