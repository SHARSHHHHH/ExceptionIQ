import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Loading, NoAccess } from './components/ui';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Cases } from './pages/Cases';
import { CaseWorkbench } from './pages/CaseWorkbench';
import { Audit } from './pages/Audit';
import { Controls, Tools } from './pages/Catalog';
import { Replay } from './pages/Replay';
import { Import } from './pages/Import';
import { Users } from './pages/Users';

/** Catches a render error in ONE screen. It is keyed by path, so navigating away always recovers. */
class ScreenBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('ExceptionIQ screen error', error, info.componentStack); }
  render() {
    if (this.state.error) {
      return <div className="ui-crash ui-crash-inline"><div><h1>This screen could not be displayed</h1><p>{this.state.error.message}</p>
        <div className="btn-row"><button className="btn btn-primary" onClick={() => this.setState({ error: null })}>Try again</button><a className="btn btn-quiet" href="/">Go to my workspace</a></div></div></div>;
    }
    return this.props.children;
  }
}

/** Route-level guard. The API enforces the same permission; this only avoids showing a screen that would be refused. */
function Guard({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useAuth();
  return can(perm) ? <>{children}</> : <NoAccess perm={perm} />;
}

function Screen({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ScreenBoundary key={pathname}>{children}</ScreenBoundary>;
}

export function App() {
  const { session, loading } = useAuth();
  if (loading) return <Loading text="Restoring session…" />;
  if (!session) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Screen><Overview /></Screen>} />
        <Route path="cases" element={<Screen><Guard perm="case:read"><Cases /></Guard></Screen>} />
        <Route path="cases/:id" element={<Screen><Guard perm="case:read"><CaseWorkbench /></Guard></Screen>} />
        <Route path="approvals" element={<Screen><Guard perm="approval:decide"><Cases approvalsOnly /></Guard></Screen>} />
        <Route path="import" element={<Screen><Guard perm="ingest:statement"><Import /></Guard></Screen>} />
        <Route path="audit" element={<Screen><Guard perm="audit:read"><Audit /></Guard></Screen>} />
        <Route path="controls" element={<Screen><Guard perm="catalog:read"><Controls /></Guard></Screen>} />
        <Route path="tools" element={<Screen><Guard perm="tools:read"><Tools /></Guard></Screen>} />
        <Route path="users" element={<Screen><Guard perm="admin:users"><Users /></Guard></Screen>} />
        <Route path="replay" element={<Screen><Guard perm="admin:reset"><Replay /></Guard></Screen>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
