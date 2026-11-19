import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import type { DiscussionSummary } from './api';

interface DiscussionsValue {
  list: DiscussionSummary[];
  /** Reloads the list, for example after a discussion was created, renamed or deleted. */
  refresh(): void;
}

const DiscussionsContext = createContext<DiscussionsValue>({ list: [], refresh: () => undefined });

export function useDiscussions(): DiscussionsValue {
  return useContext(DiscussionsContext);
}

export function DiscussionsProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<DiscussionSummary[]>([]);
  const refresh = useCallback(() => {
    // A failed reload keeps the current list; the pages report their own errors.
    api<DiscussionSummary[]>('GET', '/discussions').then(setList, () => undefined);
  }, []);
  useEffect(refresh, [refresh]);
  return <DiscussionsContext.Provider value={{ list, refresh }}>{children}</DiscussionsContext.Provider>;
}
