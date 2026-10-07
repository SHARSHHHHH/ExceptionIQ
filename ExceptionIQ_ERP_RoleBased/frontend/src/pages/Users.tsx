import { useState } from 'react';
import { Save } from 'lucide-react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useApi, useToast } from '../hooks';
import { ErrorState, Loading, PageHead, Panel, Pill, Toast } from '../components/ui';
import { dateTime, money, ROLE_LABEL, toMinor } from '../format';
import type { Role } from '../types';

interface UserRow { id: string; email: string; name: string; role: Role; entityIds: string[]; title: string; approval_limit_minor: number; active: boolean; updated_at: string | null; openCases: number }
const ROLES: Role[] = ['ANALYST', 'CONTROLLER', 'AUDITOR', 'ADMIN'];
const ENTITIES = ['IN01', 'SG01'];
const major = (minor: number) => (minor / 100).toFixed(2);

export function Users() {
  const { data, error, loading, reload } = useApi<{ users: UserRow[] }>('/admin/users');
  const { toast, show } = useToast();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  return <>
    <PageHead title="Users & roles" lede="Access is enforced by the API on every request, so changes apply on the user's next action. Every change is written to the audit trail with before and after values." />
    <div className="callout callout-warn sod-note">
      <strong>Separation-of-duties guardrails</strong>
      <span>You cannot change your own account. Only controllers can hold an approval limit. At least one active administrator must remain. Deactivating an analyst, or moving them out of the analyst role, releases their open cases to the queue.</span>
    </div>
    <Panel flush>
      <div className="table-scroll"><table className="table table-static users-table">
        <thead><tr><th>User</th><th>Role</th><th>Entities</th><th>Approval limit</th><th>Status</th><th className="r">Open cases</th><th /></tr></thead>
        <tbody>{data!.users.map((u) => <UserEditor key={`${u.id}-${u.updated_at}`} u={u} onSaved={(msg, ok) => { show(msg, ok ? 'good' : 'bad'); if (ok) reload(); }} />)}</tbody>
      </table></div>
    </Panel>
    <Toast toast={toast} />
  </>;
}

function UserEditor({ u, onSaved }: { u: UserRow; onSaved: (msg: string, ok: boolean) => void }) {
  const { session } = useAuth();
  const self = session!.user.id === u.id;
  const [role, setRole] = useState<Role>(u.role);
  const [entities, setEntities] = useState<string[]>(u.entityIds);
  const [limit, setLimit] = useState(major(u.approval_limit_minor));
  const [active, setActive] = useState(u.active);
  const [busy, setBusy] = useState(false);
  const cur = entities[0] === 'SG01' ? 'SGD' : 'INR';
  const limitMinor = role === 'CONTROLLER' ? toMinor(limit) : 0;
  const dirty = role !== u.role || active !== u.active || entities.join() !== u.entityIds.join() || (role === 'CONTROLLER' && limitMinor !== u.approval_limit_minor);
  const invalid = !entities.length || limitMinor === null;
  const toggle = (e: string) => setEntities((xs) => xs.includes(e) ? xs.filter((x) => x !== e) : [...xs, e].sort());
  const save = async () => {
    setBusy(true);
    try {
      const r = await api<{ releasedCases: number }>(`/admin/users/${u.id}`, { method: 'POST', body: { role, entityIds: entities, active, ...(role === 'CONTROLLER' ? { approvalLimitMinor: limitMinor } : {}) } });
      onSaved(`${u.name} updated${r.releasedCases ? `; ${r.releasedCases} case(s) released to the queue` : ''}`, true);
    } catch (e) { onSaved(`${u.name}: ${(e as ApiError).message}`, false); } finally { setBusy(false); }
  };
  return <tr className={!u.active ? 'row-muted' : ''}>
    <td><strong>{u.name}{self && <span className="muted"> (you)</span>}</strong><small>{u.title || u.email}</small><small>{u.email}</small></td>
    <td>{self ? ROLE_LABEL[u.role] : <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label={`Role for ${u.name}`}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>}</td>
    <td>{self ? u.entityIds.join(', ') : <div className="entity-boxes">{ENTITIES.map((e) => <label key={e} className="check"><input type="checkbox" checked={entities.includes(e)} onChange={() => toggle(e)} />{e}</label>)}</div>}</td>
    <td>{role !== 'CONTROLLER' ? <span className="muted">No authority</span> : self ? money(u.approval_limit_minor, cur)
      : <div className="limit-input"><span>{cur}</span><input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" aria-label={`Approval limit for ${u.name}`} className={limitMinor === null ? 'input-bad' : ''} /></div>}</td>
    <td>{self ? <Pill value="PASS" label="Active" /> : <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {active ? 'Active' : 'Deactivated'}</label>}</td>
    <td className="r num">{u.openCases}</td>
    <td>{self ? <span className="muted">Locked</span> : <button className="btn btn-quiet" disabled={!dirty || invalid || busy} onClick={save} title={u.updated_at ? `Last changed ${dateTime(u.updated_at)}` : undefined}><Save size={14} /> {busy ? 'Saving…' : 'Save'}</button>}</td>
  </tr>;
}
