import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { money, ROLE_LABEL } from '../format';
import type { Role } from '../types';

interface Persona { email: string; name: string; role: Role; entityIds: string[]; title?: string; approvalLimitMinor?: number }

export function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [personas, setPersonas] = useState<{ password: string; personas: Persona[] } | null>(null);

  const [apiDown, setApiDown] = useState(false);
  // The API can take a while to start on first run (Next.js compiles on demand); keep retrying quietly.
  useEffect(() => {
    let stop = false; let timer: number | undefined;
    const load = (attempt: number) => api<{ password: string; personas: Persona[] }>('/auth/personas')
      .then((p) => { if (!stop) { setPersonas(p); setApiDown(false); } })
      .catch(() => { if (stop) return; setApiDown(attempt >= 2); if (attempt < 60) timer = window.setTimeout(() => load(attempt + 1), 2000); });
    load(0);
    return () => { stop = true; window.clearTimeout(timer); };
  }, []);

  const go = async (e: string, p: string) => {
    setBusy(true); setError('');
    try { await signIn(e, p); } catch (err) { setError((err as ApiError).message); } finally { setBusy(false); }
  };
  const submit = (ev: FormEvent) => { ev.preventDefault(); go(email, password); };

  return (
    <div className="login">
      <div className="login-intro">
        <div className="brand brand-lg">Exception<span>IQ</span></div>
        <h1>Investigate a payment mismatch, prove the explanation, and close it only after a controller approves and the result is verified.</h1>
        <p>Every finding links to a source record. The model proposes; deterministic rules decide; a person authorizes; an independent check confirms.</p>
      </div>
      <div className="login-card">
        {apiDown && !personas && <div className="callout callout-warn" role="status">Waiting for the API on port 3001 to start… This page will update by itself.</div>}
        {personas && personas.personas.length > 0 && (
          <>
            <h2>Sign in as a demo user</h2>
            <p className="muted">Each role sees and can do different things. Try a case as an analyst, decide it as a controller, then review it as the auditor.</p>
            <div className="personas">
              {personas.personas.map((p) => (
                <button key={p.email} className="persona" disabled={busy} onClick={() => go(p.email, personas.password)}>
                  <span className={`role-chip role-${p.role.toLowerCase()}`}>{ROLE_LABEL[p.role]}</span>
                  <strong>{p.name}</strong>
                  <span className="muted">{p.title ? `${p.title} · ` : ''}{p.entityIds.join(', ')}{p.role === 'CONTROLLER' && p.approvalLimitMinor ? ` · approves up to ${money(p.approvalLimitMinor, p.entityIds[0] === 'SG01' ? 'SGD' : 'INR')}` : ''}</span>
                </button>
              ))}
            </div>
            <div className="divider"><span>or use credentials</span></div>
          </>
        )}
        <form onSubmit={submit}>
          <label>Work email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  );
}
