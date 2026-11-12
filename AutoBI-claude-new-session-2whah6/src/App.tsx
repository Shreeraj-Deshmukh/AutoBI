import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useEffect } from 'react';
import Layout from './components/Layout';
import Home from './pages/Home';
import Landing from './pages/Landing';
import NewProject from './pages/NewProject';
import Settings from './pages/Settings';
import ProjectShell from './components/ProjectShell';
import DashboardPreview from './pages/DashboardPreview';
import { ensureDemo } from './store/seed';
import { initAI } from './agents/llm';

export default function App() {
  useEffect(() => {
    ensureDemo();
    initAI();
  }, []);
  return (
    <HashRouter>
      <Routes>
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
      </Routes>
    </HashRouter>
  );
}
