import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { DiscussionsProvider } from './discussions';
import { Account } from './pages/Account';
import { Discussion } from './pages/Discussion';
import { NewDiscussion } from './pages/NewDiscussion';
import { Providers } from './pages/Providers';
import { SignIn } from './pages/SignIn';
import { Users } from './pages/Users';

export function App() {
  const { user } = useAuth();
  if (!user) return <SignIn />;

  const admin = user.role === 'admin';
  return (
    // Keyed by user, so nothing from a previous account stays on screen after switching.
    <DiscussionsProvider key={user.id}>
      <Layout>
        <Routes>
          <Route path="/" element={<NewDiscussion />} />
          <Route path="/d/:id" element={<Discussion />} />
          <Route path="/account" element={<Account />} />
          <Route path="/admin/providers" element={admin ? <Providers /> : <Navigate to="/" replace />} />
          <Route path="/admin/users" element={admin ? <Users /> : <Navigate to="/" replace />} />
          <Route
            path="*"
            element={
              <div className="p-6 text-sm">
                <p className="text-slate-500">This page does not exist.</p>
                <Link to="/" className="mt-2 inline-block text-indigo-600 hover:underline dark:text-indigo-400">
                  Start a new discussion
                </Link>
              </div>
            }
          />
        </Routes>
      </Layout>
    </DiscussionsProvider>
  );
}
