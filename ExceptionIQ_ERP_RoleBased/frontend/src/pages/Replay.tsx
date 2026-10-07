import { Link } from 'react-router-dom';
import { useState } from 'react';
import { RotateCcw, FilePenLine, PlugZap, Sparkles } from 'lucide-react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useApi, useToast } from '../hooks';
import { ErrorState, Loading, PageHead, Panel, Pill, Toast } from '../components/ui';
import type { CatalogData } from './Catalog';
import type { CaseSummary } from '../types';

export function Replay() {
  const { can, session } = useAuth();
  const cat = useApi<CatalogData>('/catalog');
  const cases = useApi<{ cases: CaseSummary[] }>('/cases');
  const { toast, show } = useToast();
  const [test, setTest] = useState<{ ok: boolean; message: string; ms?: number } | null>(null);
  const [testing, setTesting] = useState(false);
  if (cat.loading && !cat.data) return <Loading />;
  if (cat.error) return <ErrorState message={cat.error.message} onRetry={cat.reload} />;
  const status = new Map((cases.data?.cases ?? []).map((c) => [c.id, c.status]));
  const approved = (cases.data?.cases ?? []).filter((c) => c.status === 'APPROVED' || c.status === 'AWAITING_APPROVAL');

  const admin = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); show(ok); } catch (e) { show(`${label}: ${(e as ApiError).message}`, 'bad'); } finally { cat.reload(); cases.reload(); }
  };

  return (
    <>
      <PageHead title="Scenario lab & AI" lede="Eleven synthetic scenarios cover the happy path and every failure the controls must handle. Use this page to verify the AI connection before a demo." />
      <Panel title="AI configuration">
        <div className="ai-config">
          <div><Sparkles size={18} /><div><strong>{session!.ai.enabled ? `OpenAI model ${session!.ai.model}` : 'Deterministic mode (no API key)'}</strong>
            <p className="muted">{session!.ai.reason}</p>
            <p className="fineprint">The key is read only by the backend from <code>backend/.env.local</code> (<code>OPENAI_API_KEY</code>, <code>OPENAI_MODEL</code>, optional <code>PLANNER=openai</code>). It never reaches the browser. Restart <code>npm run dev</code> after changing it.</p></div></div>
          {can('ai:configure') && <button className="btn btn-quiet" disabled={testing} onClick={async () => { setTesting(true); try { setTest(await api('/ai/test', { method: 'POST' })); } catch (e) { setTest({ ok: false, message: (e as ApiError).message }); } finally { setTesting(false); } }}><PlugZap size={14} /> {testing ? 'Testing…' : 'Test connection'}</button>}
        </div>
        {test && <p className={`callout callout-${test.ok ? 'good' : 'bad'}`}>{test.message}{test.ms !== undefined ? ` (${test.ms} ms)` : ''}</p>}
      </Panel>
      <Panel flush>
        <div className="table-scroll"><table className="table table-static">
          <thead><tr><th>Scenario</th><th>What happens</th><th>Required outcome</th><th>Case</th></tr></thead>
          <tbody>{cat.data!.scenarios.map((s) => {
            const visible = session!.user.entityIds.includes(s.entityId);
            return (
              <tr key={s.key}>
                <td><strong>{s.title}</strong><small>{s.key} in {s.entityId}</small></td>
                <td>{s.description}</td><td className="muted">{s.expected}</td>
                <td className="nowrap">{visible ? <><Link className="link" to={`/cases/${s.caseId}`}>{s.caseId}</Link> {status.get(s.caseId) && <Pill value={status.get(s.caseId)} />}</> : <span className="muted">Hidden: entity {s.entityId} is outside your access</span>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </Panel>
      {can('admin:reset') ? (
        <div className="split">
          <Panel title="Change evidence after a proposal">
            <p>Amends the linked contract (its version and hash change). An approval made on the old evidence then stops being valid, and execution is refused.</p>
            {approved.length === 0 ? <p className="muted">No case is awaiting approval or approved yet. Investigate one first.</p> :
              <div className="btn-col">{approved.map((c) => <button key={c.id} className="btn btn-quiet" onClick={() => admin('Simulation', () => api('/admin/simulate-change', { method: 'POST', body: { caseId: c.id } }), `Contract amended for ${c.id}`)}><FilePenLine size={14} /> Amend contract for {c.id}</button>)}</div>}
          </Panel>
          <Panel title="Reset the demo">
            <p>Recreates all synthetic records and cases. The audit log restarts with a new chain.</p>
            <button className="btn btn-danger" onClick={() => window.confirm('Reset all demo data?') && admin('Reset', () => api('/admin/reset', { method: 'POST' }), 'Demo data reset')}><RotateCcw size={14} /> Reset demo data</button>
          </Panel>
        </div>
      ) : <p className="fineprint">Sign in as the administrator to reset data or amend evidence mid-flow.</p>}
      <Toast toast={toast} />
    </>
  );
}
