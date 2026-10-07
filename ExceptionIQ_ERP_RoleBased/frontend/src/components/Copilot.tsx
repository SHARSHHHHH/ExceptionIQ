import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { dateTime } from '../format';
import type { Briefing } from '../types';
import { Pill } from './ui';

const TITLE: Record<string, string> = { ANALYST: 'Investigation coach', CONTROLLER: 'Approval memo', AUDITOR: 'Control test notes', ADMIN: 'Control-health review' };

/** Role-aware AI briefing. The same component serves a single case or the whole portfolio. */
export function Copilot({ path, label = 'Generate briefing', compact = false }: { path: string; label?: string; compact?: boolean }) {
  const { session } = useAuth();
  const [b, setB] = useState<Briefing | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ai = session!.ai;
  const run = async () => {
    setBusy(true); setErr('');
    try { setB(await api<Briefing>(path, { method: 'POST' })); } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <div className={`copilot ${compact ? 'copilot-compact' : ''}`}>
      <div className="copilot-head">
        <div><strong><Sparkles size={14} /> {TITLE[session!.user.role] ?? 'Briefing'}</strong>
          <small>{ai.enabled ? `Written by ${ai.model} from case facts` : 'Deterministic engine (add an OpenAI key for model-written briefings)'}</small></div>
        <button className="btn btn-quiet" disabled={busy} onClick={run}>{busy ? 'Working…' : b ? 'Refresh' : label}</button>
      </div>
      {err && <p className="callout callout-bad">{err}</p>}
      {b && (
        <div className="copilot-body">
          <div className="copilot-title"><Pill value={b.risk_level === 'HIGH' ? 'BLOCKED' : b.risk_level === 'MEDIUM' ? 'NEEDS_REVIEW' : 'PASS'} label={`${b.risk_level.toLowerCase()} risk`} /><strong>{b.headline}</strong></div>
          <p>{b.assessment}</p>
          {b.key_points.length > 0 && <><h4>Key facts</h4><ul>{b.key_points.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
          {b.recommended_actions.length > 0 && <><h4>Suggested next steps</h4><ul>{b.recommended_actions.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
          {b.watch_outs.length > 0 && <><h4>Watch out for</h4><ul className="watch">{b.watch_outs.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
          <p className="fineprint">{b.engine === 'openai' ? `Model ${b.model}` : 'Rules engine'} · {dateTime(b.generatedAt)}{b.fallbackReason ? ` · model unavailable (${b.fallbackReason}), fell back to rules` : ''}. {b.disclaimer}</p>
        </div>
      )}
    </div>
  );
}
