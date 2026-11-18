import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Layout from './components/Layout';
import Home from './pages/Home';
import Landing from './pages/Landing';
import Login from './pages/Login';
import { useAuth } from './store/auth';
import NewProject from './pages/NewProject';
import Settings from './pages/Settings';
import ProjectShell from './components/ProjectShell';
import DashboardPreview from './pages/DashboardPreview';
import { ensureDemo } from './store/seed';
import { initAI } from './agents/llm';

/** Every page needs a signed-in user; others go to sign-in and come back to the page they asked for. */
function RequireAuth() {
  const user = useAuth((s) => s.user);
  const loc = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <Outlet />;
}

export default function App() {
  useEffect(() => {
    ensureDemo();
    initAI();
  }, []);
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Landing />} />
          <Route path="/p/:pid/preview" element={<DashboardPreview />} />
          <Route element={<Layout />}>
            <Route path="/projects" element={<Home />} />
            <Route path="/new" element={<NewProject />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/p/:pid" element={<Navigate to="requirements" replace />} />
            <Route path="/p/:pid/:stage" element={<ProjectShell />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </HashRouter>
  );
}
