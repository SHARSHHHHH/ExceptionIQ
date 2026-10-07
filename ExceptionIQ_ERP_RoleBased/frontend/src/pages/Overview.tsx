import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, CircleAlert, ClipboardList, Clock3, DatabaseZap, FileCheck2, FileUp, FlaskConical, LockKeyhole, Network, Play, ScrollText, ShieldAlert, ShieldCheck, UserRoundX, UsersRound, Workflow, Zap } from 'lucide-react';
import { api, ApiError } from '../api';
import { useApi, useToast } from '../hooks';
import { useAuth } from '../auth';
import { Copilot } from '../components/Copilot';
import { ErrorState, Loading, PageHead, Panel, Pill, Toast } from '../components/ui';
import { EXCEPTION_LABEL, money, STATUS_LABEL } from '../format';
import type { CaseSummary, Role } from '../types';

interface Metrics {
  byStatus: Record<string, number>;
  safety: { unauthorizedWrites: number; closedUnverified: number; auditChain: { valid: boolean; checked: number; headHash: string } };
  denied: { reason_code: string; n: number }[]; executions: Record<string, number>; toolCalls: Record<string, number>;
  automation: { autoMatched: number; imports: number };
}

const HEAD: Record<Role, { title: string; lede: string }> = {
  ANALYST: { title: 'Reconciliation workspace', lede: 'Import statements, let the agent investigate, and prepare rule-checked proposals. Exact payments match themselves; you work the exceptions.' },
  CONTROLLER: { title: 'Finance control center', lede: 'Decide proposals within your delegation of authority. Every approval is bound to the exact payload, evidence and policy version.' },
  AUDITOR: { title: 'Assurance workspace', lede: 'Independent, read-only view of the full case population, approvals and the hash-chained audit trail.' },
  ADMIN: { title: 'Platform administration', lede: 'Manage people and access, AI configuration and test scenarios. Administration carries no financial authority.' },
};

export function Overview() {
  const { session } = useAuth();
  const m = useApi<Metrics>('/metrics');
  const c = useApi<{ cases: CaseSummary[] }>('/cases');
  if ((m.loading && !m.data) || (c.loading && !c.data)) return <Loading />;
  if (m.error) return <ErrorState message={m.error.message} onRetry={m.reload} />;
  if (c.error) return <ErrorState message={c.error.message} onRetry={c.reload} />;
  const role = session!.user.role;
  const cases = c.data!.cases;
  const reload = () => { m.reload(); c.reload(); };
  return <>
    <PageHead title={HEAD[role].title} lede={HEAD[role].lede} />
    {role === 'ANALYST' && <AnalystHome cases={cases} m={m.data!} reload={reload} />}
    {role === 'CONTROLLER' && <ControllerHome cases={cases} />}
    {role === 'AUDITOR' && <AuditorHome cases={cases} m={m.data!} />}
    {role === 'ADMIN' && <AdminHome cases={cases} m={m.data!} />}
  </>;
}

const openResidual = (cases: CaseSummary[]) => cases.filter((x) => x.residual_minor !== null && x.status !== 'CLOSED').reduce((n, x) => n + (x.residual_minor ?? 0), 0);

function AnalystHome({ cases, m, reload }: { cases: CaseSummary[]; m: Metrics; reload: () => void }) {
  const { session } = useAuth();
  const me = session!.user.id;
  const { toast, show } = useToast();
  const [busy, setBusy] = useState(false);
  const mine = cases.filter((x) => x.assigned_to === me && x.status !== 'CLOSED');
  const queue = cases.filter((x) => x.status === 'OPEN' && (!x.assigned_to || x.assigned_to === me));
  const review = mine.filter((x) => ['NEEDS_REVIEW', 'BLOCKED'].includes(x.status));
  const runQueue = async () => {
    setBusy(true);
    try {
      const r = await api<{ investigated: number; proposals: number; review: number; blocked: number; errors: number }>('/automation/investigate-queue', { method: 'POST', body: {} });
      show(`Investigated ${r.investigated}: ${r.proposals} proposals, ${r.review} to review, ${r.blocked} blocked${r.errors ? `, ${r.errors} errors` : ''}`, r.errors ? 'bad' : 'good');
    } catch (e) { show((e as ApiError).message, 'bad'); } finally { setBusy(false); reload(); }
  };
  return <>
    <div className="erp-kpis">
      <Kpi icon={<CircleAlert />} label="Waiting in queue" value={queue.length} note="Open, unowned or yours" tone={queue.length ? 'warn' : 'good'} />
      <Kpi icon={<ClipboardList />} label="My open cases" value={mine.length} note={`${review.length} need my review`} tone={review.length ? 'warn' : undefined} />
      <Kpi icon={<Zap />} label="Auto-matched" value={m.automation.autoMatched} note={`${m.automation.imports} statement import(s)`} tone="good" />
      <Kpi icon={<Clock3 />} label="Open residual" value={money(openResidual(cases))} note="Unreconciled, all open cases" />
    </div>
    <div className="action-strip">
      <Link className="action-card" to="/import"><FileUp /><div><strong>Import bank statement</strong><span>CSV or pasted text. Exact payments auto-match; mismatches become cases.</span></div></Link>
      <button className="action-card" disabled={busy || !queue.length} onClick={runQueue}><Play /><div><strong>{busy ? 'Investigating…' : `Auto-investigate my queue (${queue.length})`}</strong><span>The agent gathers evidence and evaluates rules on every open case you can own.</span></div></button>
    </div>
    <div className="erp-grid">
      <Panel title="My work" action={<Link className="link-action" to="/cases?filter=mine">Open my cases <ArrowRight size={14} /></Link>} flush>
        {mine.length ? <MiniCaseTable rows={mine} /> : <EmptyState title="Nothing assigned to you" text="Investigating a case claims it for you automatically." />}
      </Panel>
      <Panel title="AI briefing"><Copilot path="/ai/briefing" label="Brief me on my day" /></Panel>
    </div>
    <Toast toast={toast} />
  </>;
}

function ControllerHome({ cases }: { cases: CaseSummary[] }) {
  const { session } = useAuth();
  const limit = session!.user.approvalLimitMinor ?? 0;
  const inbox = cases.filter((x) => x.status === 'AWAITING_APPROVAL');
  const above = inbox.filter((x) => (x.proposal_amount_minor ?? 0) > limit).length;
  const unowned = cases.filter((x) => !x.assigned_to && ['OPEN', 'NEEDS_REVIEW', 'BLOCKED'].includes(x.status));
  const toApply = cases.filter((x) => x.status === 'APPROVED');
  return <>
    <div className="erp-kpis">
      <Kpi icon={<CheckCircle2 />} label="Awaiting approval" value={inbox.length} note={above ? `${above} above your limit` : 'All within your limit'} tone={inbox.length ? 'warn' : 'good'} />
      <Kpi icon={<LockKeyhole />} label="Your approval limit" value={money(limit, session!.user.entityIds[0] === 'SG01' ? 'SGD' : 'INR')} note="Delegation of authority" />
      <Kpi icon={<UserRoundX />} label="Unassigned work" value={unowned.length} note="Open cases with no analyst" tone={unowned.length ? 'warn' : 'good'} />
      <Kpi icon={<Zap />} label="Approved, not applied" value={toApply.length} note="Ready for the executor" />
    </div>
    <div className="erp-grid">
      <Panel title="Approval inbox" action={<Link className="link-action" to="/approvals">Review proposals <ArrowRight size={14} /></Link>} flush>
        {inbox.length ? <MiniCaseTable rows={inbox} showProposal limit={limit} /> : <EmptyState title="Nothing waiting for approval" text="Decided proposals leave this queue automatically." />}
      </Panel>
      <Panel title="AI briefing"><Copilot path="/ai/briefing" label="Brief me on decisions" /></Panel>
    </div>
    {unowned.length > 0 && <Panel title="Unassigned exceptions" action={<Link className="link-action" to="/cases?filter=unassigned">Assign work <ArrowRight size={14} /></Link>} flush><MiniCaseTable rows={unowned} /></Panel>}
  </>;
}

function AuditorHome({ cases, m }: { cases: CaseSummary[]; m: Metrics }) {
  const s = m.safety;
  const closed = cases.filter((x) => x.status === 'CLOSED');
  return <>
    <div className="erp-kpis">
      <Kpi icon={<ShieldCheck />} label="Audit chain" value={s.auditChain.valid ? 'Intact' : 'Broken'} note={`${s.auditChain.checked} events verified`} tone={s.auditChain.valid ? 'good' : 'bad'} />
      <Kpi icon={<ShieldAlert />} label="Unauthorized writes" value={s.unauthorizedWrites} note="Writes without a valid bound approval" tone={s.unauthorizedWrites ? 'bad' : 'good'} />
      <Kpi icon={<FileCheck2 />} label="Closed without verification" value={s.closedUnverified} note={`${closed.length} closed case(s) in population`} tone={s.closedUnverified ? 'bad' : 'good'} />
      <Kpi icon={<Workflow />} label="Denied actions" value={m.denied.reduce((a, x) => a + x.n, 0)} note="Controls that fired" />
    </div>
    <div className="erp-grid">
      <Panel title="Controls that fired" flush>
        {m.denied.length ? <div className="admin-status-list pad">{m.denied.map((d) => <HealthRow key={d.reason_code} label={d.reason_code.replace(/_/g, ' ').toLowerCase()} value={d.n} ok />)}</div> : <EmptyState title="No denials yet" text="Denied actions are recorded with reason codes as they occur." />}
      </Panel>
      <Panel title="AI briefing"><Copilot path="/ai/briefing" label="Draft control-test notes" /></Panel>
    </div>
    <Panel title="Sample: verified closures" action={<Link className="link-action" to="/cases?filter=closed">Full population <ArrowRight size={14} /></Link>} flush>
      {closed.length ? <MiniCaseTable rows={closed} /> : <EmptyState title="No closed cases yet" text="Closures appear only after independent verification." />}
    </Panel>
  </>;
}

function AdminHome({ cases, m }: { cases: CaseSummary[]; m: Metrics }) {
  const s = m.safety;
  const blocked = cases.filter((c) => c.status === 'BLOCKED').length;
  const review = cases.filter((c) => c.status === 'NEEDS_REVIEW').length;
  return <>
    <div className="erp-kpis">
      <Kpi icon={<ShieldCheck />} label="Control integrity" value={s.auditChain.valid ? 'Healthy' : 'Action required'} note={`${s.auditChain.checked} audit events checked`} tone={s.auditChain.valid ? 'good' : 'bad'} />
      <Kpi icon={<ShieldAlert />} label="Unauthorized writes" value={s.unauthorizedWrites} note="Must stay zero" tone={s.unauthorizedWrites === 0 ? 'good' : 'bad'} />
      <Kpi icon={<Workflow />} label="Workflow exceptions" value={blocked + review} note={`${blocked} blocked · ${review} in review`} tone={blocked + review ? 'warn' : 'good'} />
      <Kpi icon={<DatabaseZap />} label="Cases in platform" value={cases.length} note={`${m.automation.autoMatched} auto-matched payments`} />
    </div>
    <div className="erp-grid">
      <Panel title="Administration">
        <div className="admin-module-grid">
          <Link className="admin-module" to="/users"><UsersRound /><strong>Users & roles</strong><span>Roles, entity scope, approval limits and account status.</span></Link>
          <Link className="admin-module" to="/replay"><FlaskConical /><strong>Scenario lab & AI</strong><span>Test the AI connection, replay failures, reset demo data.</span></Link>
          <Link className="admin-module" to="/tools"><Network /><strong>Tool registry</strong><span>What the agent may call, and who else may.</span></Link>
          <Link className="admin-module" to="/audit"><ScrollText /><strong>Audit trail</strong><span>Every access change and denied action is recorded.</span></Link>
        </div>
      </Panel>
      <Panel title="Operations health">
        <div className="admin-health-grid">
          <HealthRow label="Audit hash chain" value={s.auditChain.valid ? 'Valid' : 'Broken'} ok={s.auditChain.valid} />
          <HealthRow label="Unauthorized writes" value={s.unauthorizedWrites} ok={s.unauthorizedWrites === 0} />
          <HealthRow label="Closed without verification" value={s.closedUnverified} ok={s.closedUnverified === 0} />
          <HealthRow label="Agent tool calls denied" value={m.toolCalls.DENIED ?? 0} ok />
          <HealthRow label="Failed executions" value={m.executions.FAILED ?? 0} ok={!m.executions.FAILED} />
        </div>
        <p className="fineprint">Administrators cannot investigate, approve or execute, and cannot change their own access.</p>
      </Panel>
    </div>
  </>;
}

function MiniCaseTable({ rows, showProposal, limit }: { rows: CaseSummary[]; showProposal?: boolean; limit?: number }) {
  return <div className="mini-cases">{rows.slice(0, 8).map((r) => {
    const amount = showProposal ? r.proposal_amount_minor : r.residual_minor;
    const over = showProposal && limit !== undefined && (r.proposal_amount_minor ?? 0) > limit;
    return <Link key={r.id} to={`/cases/${r.id}`} className="mini-case">
      <div><strong>{r.id}</strong><span>{r.vendor_name} · {r.exception_type ? EXCEPTION_LABEL[r.exception_type] ?? r.exception_type : r.bank_txn_id}{r.assigned_to_name ? ` · ${r.assigned_to_name}` : ''}</span></div>
      <div className="mini-amount"><strong>{money(amount ?? 0, r.currency)}</strong>{over ? <Pill value="FLAGGED" label="Above your limit" /> : <Pill value={r.status} label={STATUS_LABEL[r.status]} />}</div>
    </Link>;
  })}</div>;
}
function Kpi({ icon, label, value, note, tone }: { icon: ReactNode; label: string; value: string | number; note: string; tone?: 'good' | 'warn' | 'bad' }) {
  return <div className={`erp-kpi ${tone ? `kpi-${tone}` : ''}`}><div className="kpi-icon">{icon}</div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}
function EmptyState({ title, text }: { title: string; text: string }) { return <div className="empty-state"><strong>{title}</strong><span>{text}</span></div>; }
function HealthRow({ label, value, ok }: { label: string; value: string | number; ok: boolean }) { return <div className="health-row"><span>{label}</span><strong className={ok ? 'good-text' : 'bad-text'}>{value}</strong></div>; }
