import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, errorText, SIGNED_OUT_EVENT } from './api';
import type { User } from './api';

interface AuthState {
  user: User | null;
  needsSetup: boolean;
}

interface AuthContextValue extends AuthState {
  signIn(username: string, password: string): Promise<void>;
  setup(username: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    api<AuthState>('GET', '/auth/state').then(setState, (err) => setError(errorText(err)));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    const onSignedOut = () => setState((s) => (s ? { ...s, user: null } : s));
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, []);

  if (!state) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-500">
        {error ? (
          <>
            <p className="text-red-600 dark:text-red-400">{error}</p>
            <button className="btn btn-secondary" onClick={load}>
              Try again
            </button>
          </>
        ) : (
          <p>Loading…</p>
        )}
      </div>
    );
  }

  const value: AuthContextValue = {
    ...state,
    async signIn(username, password) {
      const { user } = await api<{ user: User }>('POST', '/auth/login', { username, password });
      setState({ needsSetup: false, user });
    },
    async setup(username, password) {
      const { user } = await api<{ user: User }>('POST', '/auth/setup', { username, password });
      setState({ needsSetup: false, user });
    },
    async signOut() {
      await api('POST', '/auth/logout').catch(() => undefined);
      setState({ needsSetup: false, user: null });
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
