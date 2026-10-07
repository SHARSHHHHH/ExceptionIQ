import { useMemo, useState } from 'react';
import { ChevronRight, Filter, Play } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useApi, useToast } from '../hooks';
import { useAuth } from '../auth';
import { Empty, ErrorState, Loading, PageHead, Panel, Pill, Toast } from '../components/ui';
import { EXCEPTION_LABEL, money, STATUS_LABEL } from '../format';
import type { CaseStatus, CaseSummary } from '../types';

interface F { key: string; label: string; match: (c: CaseSummary, me: string) => boolean }
const FILTERS: F[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'mine', label: 'Mine', match: (c, me) => c.assigned_to === me && c.status !== 'CLOSED' },
  { key: 'todo', label: 'Needs action', match: (c) => ['OPEN', 'NEEDS_REVIEW'].includes(c.status) },
  { key: 'unassigned', label: 'Unassigned', match: (c) => !c.assigned_to && ['OPEN', 'NEEDS_REVIEW', 'BLOCKED'].includes(c.status) },
  { key: 'approval', label: 'Approval', match: (c) => ['AWAITING_APPROVAL', 'APPROVED'].includes(c.status) },
  { key: 'blocked', label: 'Blocked', match: (c) => c.status === 'BLOCKED' },
  { key: 'closed', label: 'Verified closed', match: (c) => c.status === 'CLOSED' },
];
const FILTERS_FOR = { ANALYST: ['mine', 'todo', 'all', 'unassigned', 'approval', 'blocked', 'closed'], CONTROLLER: ['all', 'approval', 'unassigned', 'todo', 'blocked', 'closed'],
  AUDITOR: ['all', 'closed', 'approval', 'blocked', 'todo'], ADMIN: ['all', 'todo', 'unassigned', 'blocked', 'approval', 'closed'] } as const;

export function Cases({ approvalsOnly = false }: { approvalsOnly?: boolean }) {
  const { session, can } = useAuth();
  const role = session!.user.role; const me = session!.user.id; const limit = session!.user.approvalLimitMinor ?? 0;
  const { data, error, loading, reload } = useApi<{ cases: CaseSummary[] }>('/cases');
  const [params, setParams] = useSearchParams();
  const allowed = FILTERS.filter((f) => (FILTERS_FOR[role] as readonly string[]).includes(f.key));
  const fromUrl = params.get('filter');
  const filter = approvalsOnly ? 'approval' : allowed.some((f) => f.key === fromUrl) ? fromUrl! : allowed[0].key;
  const setFilter = (k: string) => setParams(k === allowed[0].key ? {} : { filter: k });
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast, show } = useToast();
  const all = data?.cases ?? [];
  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!; const n = q.trim().toLowerCase();
    return all.filter((c) => (approvalsOnly ? c.status === 'AWAITING_APPROVAL' : f.match(c, me)) && (!n || `${c.id} ${c.vendor_name} ${c.bank_txn_id} ${c.scenarioTitle} ${c.assigned_to_name ?? ''}`.toLowerCase().includes(n)));
  }, [all, filter, q, me, approvalsOnly]);
  const queueable = all.filter((c) => c.status === 'OPEN' && (!c.assigned_to || c.assigned_to === me)).length;

  const runQueue = async () => {
    setBusy(true);
    try {
      const r = await api<{ investigated: number; proposals: number; review: number; blocked: number }>('/automation/investigate-queue', { method: 'POST', body: {} });
      show(`Investigated ${r.investigated}: ${r.proposals} proposals, ${r.review} to review, ${r.blocked} blocked`);
    } catch (e) { show((e as ApiError).message, 'bad'); } finally { setBusy(false); reload(); }
  };

  const title = approvalsOnly ? 'Approval inbox' : { ANALYST: 'Exception queue', CONTROLLER: 'Finance exceptions', AUDITOR: 'Case population', ADMIN: 'All cases' }[role];
  const lede = approvalsOnly ? `Proposals waiting for a controller. You can approve up to ${money(limit, session!.user.entityIds[0] === 'SG01' ? 'SGD' : 'INR')}; larger adjustments are routed to a higher-limit controller.`
    : { ANALYST: 'Investigating a case claims it for you. Cases owned by another analyst are visible but locked to them.',
      CONTROLLER: 'Monitor exposure and ownership. Assign unowned exceptions from the case screen.',
      AUDITOR: 'The complete population in your entities. Read-only.', ADMIN: 'Platform-wide view. Administrators do not work or decide cases.' }[role];
  return <>
    <PageHead title={title} lede={lede} actions={can('automation:batch') && !approvalsOnly ? <button className="btn btn-primary" disabled={busy || !queueable} onClick={runQueue}><Play size={14} /> {busy ? 'Investigating…' : `Auto-investigate (${queueable})`}</button> : undefined} />
    <div className="queue-summary"><div><Filter size={14} /><strong>{rows.length}</strong><span>cases in view</span></div><div><strong>{money(rows.filter((c) => c.status !== 'CLOSED').reduce((a, c) => a + (c.residual_minor ?? 0), 0))}</strong><span>open residual in view</span></div></div>
    {!approvalsOnly && <div className="toolbar">
      <div className="chips" role="tablist">{allowed.map((f) => <button key={f.key} role="tab" aria-selected={filter === f.key} className={`chip ${filter === f.key ? 'chip-on' : ''}`} onClick={() => setFilter(f.key)}>{f.label} <span className="chip-n">{all.filter((c) => f.match(c, me)).length}</span></button>)}</div>
      <input className="search" placeholder="Search case, vendor, bank ref or owner" value={q} onChange={(e) => setQ(e.target.value)} />
    </div>}
    <Panel flush>{loading && !data ? <Loading /> : error ? <ErrorState message={error.message} onRetry={reload} /> :
      <CaseTable cases={rows} limit={approvalsOnly ? limit : undefined} empty={approvalsOnly ? 'No proposals are waiting for a decision.' : 'No cases match this filter.'} />}</Panel>
    <Toast toast={toast} />
  </>;
}

const OWNER: Partial<Record<CaseStatus, string>> = { OPEN: 'Analyst', INVESTIGATING: 'Agent', AWAITING_APPROVAL: 'Controller', APPROVED: 'Executor', EXECUTING: 'Executor', VERIFYING: 'Verifier', NEEDS_REVIEW: 'Analyst', BLOCKED: 'Analyst', CLOSED: 'Complete' };

export function CaseTable({ cases, empty, limit }: { cases: CaseSummary[]; empty: string; limit?: number }) {
  const nav = useNavigate();
  if (!cases.length) return <Empty title={empty} />;
  return <div className="table-scroll"><table className="table">
    <thead><tr><th>Case / source</th><th>Vendor</th><th>Exception</th><th className="r">Bank paid</th><th className="r">{limit !== undefined ? 'Adjustment' : 'Residual'}</th><th>Status</th><th>Owner</th><th /></tr></thead>
    <tbody>{cases.map((c) => {
      const over = limit !== undefined && (c.proposal_amount_minor ?? 0) > limit;
      return <tr key={c.id} onClick={() => nav(`/cases/${c.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/cases/${c.id}`)}>
        <td><strong>{c.id}</strong><small>{c.bank_txn_id} · {c.value_date}{c.source === 'IMPORT' ? ' · imported' : ''}</small></td>
        <td>{c.vendor_name}<small>{c.entity_id}</small></td>
        <td>{c.exception_type ? EXCEPTION_LABEL[c.exception_type] ?? c.exception_type : '—'}<small>{c.scenarioTitle}</small></td>
        <td className="r num">{money(c.paid_minor, c.currency)}</td>
        <td className="r num">{limit !== undefined ? <>{money(c.proposal_amount_minor, c.currency)}{over && <small className="bad-text">above your limit</small>}</> : c.residual_minor === null ? '—' : money(c.residual_minor, c.currency)}</td>
        <td><Pill value={c.status} label={STATUS_LABEL[c.status]} /></td>
        <td><span className="next-owner">{c.assigned_to_name ?? <span className="muted">Unassigned</span>}</span><small>Next: {OWNER[c.status]}</small></td>
        <td><ChevronRight size={16} /></td>
      </tr>;
    })}</tbody>
  </table></div>;
}
