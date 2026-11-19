import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { useDiscussions } from '../discussions';

const navLink = ({ isActive }: { isActive: boolean }) =>
  `block truncate rounded-lg px-3 py-2 text-sm ${
    isActive
      ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
  }`;

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const { list } = useDiscussions();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // On small screens the sidebar is an overlay: close it after navigating.
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="flex h-full">
      {open && <div className="fixed inset-0 z-20 bg-black/40 md:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform md:static md:translate-x-0 dark:border-slate-800 dark:bg-slate-900 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-3">
          <Link to="/" className="mb-3 block px-2 text-lg font-semibold">
            💬 Multichat
          </Link>
          <Link to="/" className="btn btn-primary w-full">
            New discussion
          </Link>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Discussions">
          {list.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">No discussions yet.</p>}
          {list.map((d) => (
            <NavLink key={d.id} to={`/d/${d.id}`} className={navLink} title={d.title}>
              {d.title}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-0.5 border-t border-slate-200 p-3 dark:border-slate-800">
          {user?.role === 'admin' && (
            <>
              <NavLink to="/admin/providers" className={navLink}>
                Providers and models
              </NavLink>
              <NavLink to="/admin/users" className={navLink}>
                Users
              </NavLink>
            </>
          )}
          <NavLink to="/account" className={navLink}>
            Account ({user?.username})
          </NavLink>
          <button
            className="block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white p-2 md:hidden dark:border-slate-800 dark:bg-slate-900">
          <button className="btn btn-secondary" onClick={() => setOpen(true)} aria-label="Open menu">
            ☰
          </button>
          <span className="font-semibold">Multichat</span>
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
