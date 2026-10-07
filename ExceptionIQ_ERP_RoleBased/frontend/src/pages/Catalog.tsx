import { Eye, Scale, SearchCheck, Settings2 } from 'lucide-react';
import { useApi } from '../hooks';
import { useAuth } from '../auth';
import { ErrorState, Loading, PageHead, Panel, Pill } from '../components/ui';
import { humanize, ROLE_LABEL } from '../format';
import type { AiStatus, Role, RoleProfile } from '../types';

export interface CatalogData {
  policyPack: { id: string; version: string; name: string };
  rules: { id: string; name: string; version: string; onFail: string; description: string }[];
  tools: { name: string; access: string; description: string; boundary: string; callers: string[] }[];
  scenarios: { key: string; title: string; description: string; expected: string; entityId: string; caseId: string; faults: Record<string, boolean> }[];
  permissions: Record<string, string[]>;
  transitions: Record<string, string[]>;
  policyMatrix: { condition: string; behavior: string; enforcedBy: string }[];
  roles: Record<Role, RoleProfile>;
  ai: AiStatus;
  runtime: { planner: string; model: string | null; budgets: Record<string, number>; approvalTtlMinutes: number };
}

export function Controls() {
  const { session } = useAuth();
  const { data, error, loading, reload } = useApi<CatalogData>('/catalog');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  const c = data!;
  const roles: Role[] = ['ANALYST', 'CONTROLLER', 'AUDITOR', 'ADMIN'];
  const role = session?.user.role;
  const pack = `${c.policyPack.id} v${c.policyPack.version}`;
  const title = { ANALYST: 'Investigation rules & evidence controls', CONTROLLER: 'Financial policy & approval authority', AUDITOR: 'Control design & separation of duties', ADMIN: 'Governance, RBAC & policy controls' }[role ?? 'ANALYST'];
  const lede = { ANALYST: `Policy pack ${pack}: which evidence and deterministic checks support your investigation. You investigate and propose; you never approve.`,
    CONTROLLER: `Policy pack ${pack}: the rules that decide whether an adjustment may be proposed, and the limits on who may approve it.`,
    AUDITOR: `Policy pack ${pack}: the designed controls to test against the case population and audit trail.`,
    ADMIN: `Policy pack ${pack}: RBAC, separation of duties and runtime boundaries. Configuration never grants financial authority.` }[role ?? 'ANALYST'];
  return (
    <>
      <PageHead title={title} lede={lede} />
      <Panel title="Your mandate">
        {role === 'ANALYST' && <div className="control-banner"><SearchCheck/><div><strong>Find and prove the exception.</strong><p>Gather permitted evidence, inspect deterministic findings and prepare a resolution proposal. Financial approval remains outside the analyst role.</p></div></div>}
        {role === 'CONTROLLER' && <div className="control-banner"><Scale/><div><strong>Authorize the exact financial action.</strong><p>Review the amount bridge, evidence manifest, rule results, journal and policy binding. Approval is for the exact payload, not the model narrative.</p></div></div>}
        {role === 'AUDITOR' && <div className="control-banner"><Eye/><div><strong>Test the controls independently.</strong><p>You can read every case, approval and audit event in your entities and export bundles, but you cannot change anything. That independence is the point.</p></div></div>}
        {role === 'ADMIN' && <div className="control-banner"><Settings2/><div><strong>Protect the operating model.</strong><p>Inspect role boundaries, tool allowlists, policy versions, scenario controls and audit integrity. Do not use administration as a substitute for controller approval.</p></div></div>}
      </Panel>
      <Panel title="Role mandates" flush>
        <div className="role-grid">{roles.map((r) => <div key={r} className={`role-card ${r === role ? 'role-card-me' : ''}`}>
          <span className={`role-chip role-${r.toLowerCase()}`}>{ROLE_LABEL[r]}</span>
          <p>{c.roles[r].mandate}</p>
          <strong>Cannot</strong><ul>{c.roles[r].cannot.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>)}</div>
      </Panel>
      <Panel title="Policy behaviour" flush>
        <div className="table-scroll"><table className="table table-static">
          <thead><tr><th>Condition</th><th>Required behaviour</th><th>Enforced by</th></tr></thead>
          <tbody>{c.policyMatrix.map((p) => <tr key={p.condition}><td><strong>{p.condition}</strong></td><td>{p.behavior}</td><td className="muted">{p.enforcedBy}</td></tr>)}</tbody>
        </table></div>
      </Panel>
      <Panel title="Deterministic rules" flush>
        <div className="table-scroll"><table className="table table-static">
          <thead><tr><th>Rule</th><th>What it checks</th><th>On failure</th></tr></thead>
          <tbody>{c.rules.map((r) => <tr key={r.id}><td><strong>{r.id} {r.name}</strong><small>v{r.version}</small></td><td>{r.description}</td><td><Pill value={r.onFail === 'BLOCK' ? 'BLOCK' : 'NEEDS_REVIEW'} label={r.onFail === 'BLOCK' ? 'Block' : 'Review'} /></td></tr>)}</tbody>
        </table></div>
      </Panel>
      <div className="split">
        <Panel title="Who can do what" flush>
          <div className="table-scroll"><table className="table table-static matrix">
            <thead><tr><th>Permission</th>{roles.map((r) => <th key={r}>{ROLE_LABEL[r]}</th>)}</tr></thead>
            <tbody>{Object.entries(c.permissions).map(([perm, rs]) => <tr key={perm}><td><code>{perm}</code></td>{roles.map((r) => <td key={r} className={rs.includes(r) ? 'yes' : 'no'}>{rs.includes(r) ? 'Yes' : '—'}</td>)}</tr>)}</tbody>
          </table></div>
          <p className="fineprint pad">Administrators and auditors hold no approval authority. The investigator of a case can never approve it, and each controller approves only up to their own limit.</p>
        </Panel>
        <Panel title="Runtime limits">
          <dl className="grid-kv">
            <div className="kv"><dt>Planner</dt><dd>{c.runtime.planner}{c.runtime.model ? ` (${c.runtime.model})` : ''}</dd></div>
            <div className="kv"><dt>AI assistance</dt><dd>{c.ai.enabled ? `On (${c.ai.model})` : 'Deterministic mode'}</dd></div>
            {Object.entries(c.runtime.budgets).map(([k, v]) => <div className="kv" key={k}><dt>{humanize(k.replace(/([A-Z])/g, '_$1').toUpperCase())}</dt><dd>{v}</dd></div>)}
            <div className="kv"><dt>Approval validity</dt><dd>{c.runtime.approvalTtlMinutes / 60} hours</dd></div>
          </dl>
          <h3 className="sub">Legal case transitions</h3>
          <ul className="transitions">{Object.entries(c.transitions).map(([from, to]) => <li key={from}><Pill value={from} /> {to.length ? <span>→ {to.map(humanize).join(', ')}</span> : <span className="muted">terminal</span>}</li>)}</ul>
        </Panel>
      </div>
    </>
  );
}

export function Tools() {
  const { data, error, loading, reload } = useApi<CatalogData>('/catalog');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  return (
    <>
      <PageHead title="Tool registry" lede="The complete allowlist. The planner may only request read tools; any other name, including payment or bank-detail tools, is denied and logged. The read tools are also exposed over MCP through the same gateway." />
      <Panel flush>
        <div className="table-scroll"><table className="table table-static">
          <thead><tr><th>Tool</th><th>Access</th><th>Who may call it</th><th>Boundary</th></tr></thead>
          <tbody>{data!.tools.map((t) => (
            <tr key={t.name}><td><code className="tool">{t.name}</code><small>{t.description}</small></td>
              <td><Pill value={t.access === 'WRITE' ? 'BLOCK' : t.access === 'COMPUTE' ? 'INFO' : 'PASS'} label={humanize(t.access)} /></td>
              <td>{t.callers.map((x) => x === 'agent' ? 'Planner (model)' : humanize(x)).join(', ')}</td><td className="muted">{t.boundary}</td></tr>))}
          </tbody>
        </table></div>
      </Panel>
    </>
  );
}
