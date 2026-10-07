import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Download, Hand, MessageSquarePlus, Play, ShieldAlert, Stamp, UserRoundCog, Zap } from 'lucide-react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useApi, useToast } from '../hooks';
import { EvidenceGraph } from '../components/EvidenceGraph';
import { Copilot } from '../components/Copilot';
import { Lifecycle } from '../components/Lifecycle';
import { Empty, ErrorState, Hash, KV, Loading, Panel, Pill, Toast } from '../components/ui';
import { dateTime, EXCEPTION_LABEL, humanize, money, time } from '../format';
import type { CaseDetail, Proposal, Role } from '../types';

type Tab = 'graph' | 'trace' | 'rules' | 'proposal' | 'audit';

const TABS: Record<Role, [Tab, string][]> = {
  ANALYST: [['graph', 'Evidence graph'], ['trace', 'Investigation trace'], ['rules', 'Deterministic findings'], ['proposal', 'Resolution proposal'], ['audit', 'Case audit']],
  CONTROLLER: [['proposal', 'Approval payload'], ['rules', 'Rule results'], ['graph', 'Evidence for decision'], ['trace', 'Investigation evidence'], ['audit', 'Approval & audit']],
  AUDITOR: [['audit', 'Audit events'], ['proposal', 'Approvals & execution'], ['rules', 'Rule results'], ['graph', 'Evidence graph'], ['trace', 'Agent activity']],
  ADMIN: [['trace', 'Agent activity'], ['graph', 'Control evidence graph'], ['rules', 'Policy results'], ['audit', 'Governance audit'], ['proposal', 'Execution record']],
};

export function CaseWorkbench() {
  const { id = '' } = useParams();
  const { session } = useAuth();
  const role = session?.user.role ?? 'ANALYST';
  const { data, error, loading, reload } = useApi<CaseDetail>(`/cases/${id}`);
  const [tab, setTab] = useState<Tab>(TABS[role][0][0]);
  const { toast, show } = useToast();

  if (loading && !data) return <Loading text="Loading case…" />;
  if (error) return <ErrorState message={error.status === 404 ? `Case ${id} was not found, or it belongs to an entity you cannot access.` : error.message} onRetry={reload} />;
  const d = data!;
  const c = d.case;
  const cur = c.currency;
  const plan = d.plans[0];
  const proposal = d.proposals.find((p) => ['PENDING_APPROVAL', 'APPROVED'].includes(p.status)) ?? d.proposals[0];
  const deniedCount = d.toolCalls.filter((t) => t.run_no === d.latestRun && t.decision !== 'ALLOWED').length;

  const act = async (label: string, fn: () => Promise<unknown>, success: string) => {
    try { await fn(); show(success); } catch (e) { show(`${label}: ${(e as ApiError).message}`, 'bad'); } finally { reload(); }
  };

  return (
    <>
      <Link to="/cases" className="back"><ArrowLeft size={14} /> All cases</Link>
      <div className="case-head">
        <div>
          <h1>{c.id} <Pill value={c.status} /></h1>
          <p className="case-sub">{d.bank.counterparty_name} paid {money(d.bank.amount_minor, cur)} on {d.bank.value_date} (bank reference {d.bank.reference}).</p>
          <p className="case-tags">{c.exception_type && <span className="tag">{EXCEPTION_LABEL[c.exception_type] ?? c.exception_type}</span>}<span className="tag">{c.source === 'IMPORT' ? 'From statement import' : 'Seeded scenario'}</span><span className="tag">Owner: {c.assigned_to_name ?? 'unassigned'}</span></p>
        </div>
        <div className="case-facts">
          {c.status === 'CLOSED'
            ? <KV k="Residual now" v={<span className="num big">{money(0, cur)}<small className="was">was {money(c.residual_minor, cur)}</small></span>} />
            : <KV k="Residual found" v={<span className="num big">{money(c.residual_minor, cur)}</span>} />}
          <KV k="Entity" v={c.entity_id} />
          <KV k="Risk class" v={c.risk_class ? humanize(c.risk_class) : 'Not assessed'} />
        </div>
      </div>
      <Lifecycle status={c.status} reachedApproval={d.proposals.length > 0} executed={d.executions.length > 0} />
      <FinancialBridge d={d} />

      <div className="workbench">
        <div className="wb-main">
          <div className="tabs" role="tablist">
            {TABS[role].map(([k, base]) => [k, k === 'trace' && deniedCount ? `${base} (${deniedCount} denied)` : base] as const
            ).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'tab-on' : ''} ${k === 'trace' && deniedCount ? 'tab-alert' : ''}`} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>
          <div className="tab-panel">
            {d.latestRun === 0 && tab !== 'audit' ? <Empty title="Not investigated yet">Run the investigation to retrieve records, evaluate rules and build the evidence graph.</Empty> : (
              <>
                {tab === 'graph' && <EvidenceGraph key={`${d.latestRun}-${d.graph.nodes.length}`} nodes={d.graph.nodes} edges={d.graph.edges} />}
                {tab === 'trace' && <Trace d={d} />}
                {tab === 'rules' && <Rules d={d} />}
                {tab === 'proposal' && <ProposalView d={d} />}
              </>
            )}
            {tab === 'audit' && <AuditList d={d} />}
          </div>
        </div>

        <aside className="wb-side">
          <DecisionPanel d={d} proposal={proposal} act={act} />
          <OwnershipPanel d={d} act={act} />
          {d.viewer.canUseAi && <Panel title="AI copilot"><Copilot path={`/cases/${c.id}/assist`} compact /></Panel>}
          <NotesPanel d={d} act={act} />
          {plan && (
            <Panel title="Hypotheses">
              <ul className="hypotheses">
                {plan.hypotheses.map((h) => (
                  <li key={h.code}><div><strong>{h.title}</strong>{h.note && <small>{h.note}</small>}</div><Pill value={h.status} /></li>
                ))}
              </ul>
            </Panel>
          )}
          {c.explanation && (
            <Panel title="Planner summary">
              <p className="explanation">{c.explanation}</p>
              <p className="fineprint">Drafted by the {plan?.planner === 'openai' ? `model (${plan.model})` : 'deterministic planner'} from rule results. It is not itself a rule result and carries no authority.</p>
            </Panel>
          )}
          {d.scenario && (
            <Panel title="About this scenario">
              <p>{d.scenario.description}</p>
              <p className="fineprint">Expected: {d.scenario.expected}</p>
            </Panel>
          )}
        </aside>
      </div>
      <Toast toast={toast} />
    </>
  );
}

function FinancialBridge({ d }: { d: CaseDetail }) {
  const p = d.proposals[0];
  const invoiceExpected = p?.payload.before.open_item_residual_minor != null ? d.bank.amount_minor + p.payload.before.open_item_residual_minor : null;
  const discount = p?.payload.discount_minor ?? d.case.residual_minor ?? 0;
  const finalResidual = d.case.status === 'CLOSED' ? 0 : (p?.payload.expected_residual_after_minor ?? d.case.residual_minor ?? null);
  return <Panel title="Financial reconciliation bridge" className="finance-bridge">
    <div className="money-bridge">
      <MoneyStep label="Bank payment" value={d.bank.amount_minor} currency={d.bank.currency} note="Cash actually received/paid"/>
      <ArrowRight className="money-arrow"/>
      <MoneyStep label="ERP expected" value={invoiceExpected} currency={d.bank.currency} note="Invoice settlement expectation"/>
      <ArrowRight className="money-arrow"/>
      <MoneyStep label="Eligible adjustment" value={discount} currency={d.bank.currency} note="Deterministic discount" tone="warn"/>
      <ArrowRight className="money-arrow"/>
      <MoneyStep label="Final residual" value={finalResidual} currency={d.bank.currency} note={d.case.status === 'CLOSED' ? 'Verified = zero' : 'Must reach zero before closure'} tone={d.case.status === 'CLOSED' ? 'good' : undefined}/>
    </div>
    <div className="finance-explainer"><strong>What this means:</strong><span>{p ? `${money(d.bank.amount_minor,d.bank.currency)} payment + ${money(discount,d.bank.currency)} approved adjustment = ${money(invoiceExpected ?? 0,d.bank.currency)} ERP expectation.` : `The bank payment is ${money(d.bank.amount_minor,d.bank.currency)}. Investigation will determine why it differs from the ERP expectation.`}</span></div>
  </Panel>;
}
function MoneyStep({label,value,currency,note,tone}:{label:string;value:number|null;currency:string;note:string;tone?:'good'|'warn'}){return <div className={`money-step ${tone?`money-${tone}`:''}`}><span>{label}</span><strong>{value==null?'—':money(value,currency)}</strong><small>{note}</small></div>}

function DecisionPanel({ d, proposal, act }: { d: CaseDetail; proposal?: Proposal; act: (l: string, fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const v = d.viewer;
  const title = { ANALYST: 'Analyst action', CONTROLLER: 'Controller decision', AUDITOR: 'Assurance view', ADMIN: 'Administrator view' }[v.role];
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const c = d.case;
  const run = async (label: string, fn: () => Promise<unknown>, ok: string) => { setBusy(true); await act(label, fn, ok); setBusy(false); };
  const approval = proposal ? d.approvals.find((a) => a.proposal_id === proposal.id) : undefined;
  const lastVer = d.verifications[0];
  const flags = d.graph.nodes.filter((n) => n.type === 'Finding' && n.status === 'FLAGGED');
  const readOnly = v.role === 'AUDITOR' || v.role === 'ADMIN';

  let body: ReactNode;
  if (['OPEN', 'NEEDS_REVIEW', 'BLOCKED'].includes(c.status)) {
    body = <>
      {c.status !== 'OPEN' && <p className={`callout callout-${c.status === 'BLOCKED' ? 'bad' : 'warn'}`}>{c.status_reason}</p>}
      {c.status === 'OPEN' && <p>Bank, ERP, invoice, vendor and, if a difference remains, contract records will be read through the controlled tool gateway.</p>}
      {v.canInvestigate
        ? <button className="btn btn-primary btn-block" disabled={busy} onClick={() => run('Investigation', () => api(`/cases/${c.id}/investigate`, { method: 'POST' }), 'Investigation finished')}>
            <Play size={15} /> {c.status === 'OPEN' ? 'Run investigation' : 'Re-investigate'}</button>
        : <p className="muted">{v.investigateBlockedReason ?? 'No action for your role.'}</p>}
      {v.canInvestigate && !c.assigned_to && <p className="fineprint">Running the investigation assigns the case to you.</p>}
    </>;
  } else if (c.status === 'AWAITING_APPROVAL' && proposal) {
    body = <>
      <Binding p={proposal} />
      {v.canReject ? <>
        {v.approveBlockedReason && <p className="callout callout-warn">{v.approveBlockedReason}. You can still reject or leave it for a controller with a higher limit.</p>}
        <label className="field">Reason (required to reject)<textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Evidence and rule results reviewed" /></label>
        <div className="btn-row">
          <button className="btn btn-primary" disabled={busy || !v.canApprove} title={v.approveBlockedReason ?? undefined} onClick={() => run('Approval', () => api(`/cases/${c.id}/decision`, { method: 'POST', body: { proposalId: proposal.id, decision: 'APPROVED', reason: reason || undefined } }), 'Approved: the exact payload above is now authorized')}><Stamp size={15} /> Approve this change</button>
          <button className="btn btn-danger" disabled={busy || reason.trim().length < 5} title={reason.trim().length < 5 ? 'Enter a reason of at least 5 characters' : undefined} onClick={() => run('Rejection', () => api(`/cases/${c.id}/decision`, { method: 'POST', body: { proposalId: proposal.id, decision: 'REJECTED', reason } }), 'Rejected: case returned for review')}>Reject</button>
        </div>
      </> : <p className="muted">{v.approveBlockedReason ?? 'Waiting for a finance controller to approve or reject this exact payload.'}</p>}
      {v.canAttemptUnapprovedWrite && v.role === 'ANALYST' && (
        <button className="btn btn-ghost-bad btn-block" disabled={busy} onClick={() => run('Write attempt', () => api(`/cases/${c.id}/execute`, { method: 'POST', body: { proposalId: proposal.id } }), 'Unexpected: write was allowed')}>
          <ShieldAlert size={15} /> Attempt the write before approval</button>
      )}
    </>;
  } else if (c.status === 'APPROVED' && proposal) {
    body = <>
      <p>Approved by <strong>{approval?.approver_name}</strong>. The approval is bound to the hashes below and expires {dateTime(approval?.expires_at)}.</p>
      <Binding p={proposal} />
      {v.canExecute
        ? <button className="btn btn-primary btn-block" disabled={busy} onClick={() => run('Execution', () => api(`/cases/${c.id}/execute`, { method: 'POST', body: { proposalId: proposal.id } }), 'Executed and verified')}><Zap size={15} /> Apply approved change</button>
        : <p className="muted">Analysts and controllers trigger the restricted executor.</p>}
    </>;
  } else if (c.status === 'CLOSED') {
    body = <p className="callout callout-good">Closed after independent verification: residual zero, one payment link, one balanced journal{lastVer ? ` (${time(lastVer.created_at)})` : ''}.</p>;
  } else {
    body = <p className="muted">{humanize(c.status)}…</p>;
  }
  return (
    <Panel title={title} className="decision">
      {flags.length > 0 && ['AWAITING_APPROVAL', 'APPROVED'].includes(c.status) && (
        <div className="callout callout-warn">{flags.map((f) => <p key={f.id}><strong>Flag:</strong> {f.label}</p>)}<p>Text in retrieved records cannot change tools, policy or approvals. Review it before you decide.</p></div>
      )}
      {readOnly && <p className="fineprint">Your role is read-only on cases. Actions shown here are performed by analysts and controllers.</p>}
      {body}
    </Panel>
  );
}

function OwnershipPanel({ d, act }: { d: CaseDetail; act: (l: string, fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const v = d.viewer; const c = d.case;
  const [list, setList] = useState<{ id: string; name: string }[] | null>(null);
  const [pick, setPick] = useState('');
  if (!v.canClaim && !v.canAssign) {
    return <Panel title="Ownership"><p>{c.assigned_to_name ? <>Owned by <strong>{c.assigned_to_name}</strong>{v.isAssignee ? ' (you)' : ''}.</> : 'No analyst owns this case yet.'}</p></Panel>;
  }
  const loadList = async () => { if (!list) setList((await api<{ assignees: { id: string; name: string }[] }>(`/cases/${c.id}/assignees`)).assignees); };
  return <Panel title="Ownership">
    <p>{c.assigned_to_name ? <>Owned by <strong>{c.assigned_to_name}</strong>.</> : 'No analyst owns this case yet.'}</p>
    {v.canClaim && <button className="btn btn-quiet btn-block" onClick={() => act('Claim', () => api(`/cases/${c.id}/claim`, { method: 'POST' }), 'Case assigned to you')}><Hand size={14} /> Claim this case</button>}
    {v.canAssign && <div className="assign-row">
      <select value={pick} onFocus={loadList} onMouseDown={loadList} onChange={(e) => setPick(e.target.value)} aria-label="Assign to analyst">
        <option value="">{list ? 'Choose an analyst…' : 'Load analysts…'}</option>
        {list?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        {c.assigned_to && <option value="__none">Unassign</option>}
      </select>
      <button className="btn btn-quiet" disabled={!pick} onClick={() => act('Assignment', () => api(`/cases/${c.id}/assign`, { method: 'POST', body: { assigneeId: pick === '__none' ? null : pick } }), pick === '__none' ? 'Case unassigned' : 'Case reassigned')}><UserRoundCog size={14} /> Assign</button>
    </div>}
  </Panel>;
}

function NotesPanel({ d, act }: { d: CaseDetail; act: (l: string, fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const [body, setBody] = useState('');
  return <Panel title={`Notes (${d.notes.length})`}>
    {d.notes.length ? <ol className="notes">{d.notes.map((n) => <li key={n.id}><div><strong>{n.author_name}</strong><span className="muted"> · {humanize(n.author_role)} · {dateTime(n.created_at)}</span></div><p>{n.body}</p></li>)}</ol> : <p className="muted">No notes yet.</p>}
    {d.viewer.canComment && <>
      <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note for the case record" className="note-input" />
      <button className="btn btn-quiet" disabled={body.trim().length < 2} onClick={async () => { await act('Note', () => api(`/cases/${d.case.id}/notes`, { method: 'POST', body: { body } }), 'Note added'); setBody(''); }}><MessageSquarePlus size={14} /> Add note</button>
    </>}
  </Panel>;
}

function Binding({ p }: { p: Proposal }) {
  const cur = p.payload.currency;
  return (
    <div className="binding">
      <p className="binding-title">This approval authorizes exactly:</p>
      <table className="journal">
        <thead><tr><th>Account</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
        <tbody>{p.payload.journal.lines.map((l) => <tr key={l.account}><td>{l.account} {l.name}</td><td className="r num">{l.debit_minor ? money(l.debit_minor, cur) : ''}</td><td className="r num">{l.credit_minor ? money(l.credit_minor, cur) : ''}</td></tr>)}</tbody>
      </table>
      <p className="binding-match">and matching {p.payload.bank_txn_id} to {p.payload.invoice_id} for {money(p.payload.match_amount_minor, cur)}, leaving a residual of {money(p.payload.expected_residual_after_minor, cur)}.</p>
      <dl className="binding-hashes">
        <KV k="Payload" v={<Hash value={p.payload_hash} />} />
        <KV k="Evidence" v={<Hash value={p.evidence_hash} />} />
        <KV k="Policy" v={<code className="hash">{p.policy_version}</code>} />
      </dl>
      <p className="fineprint">If the payload, any source record, or the policy version changes, this approval stops being valid.</p>
    </div>
  );
}

function Trace({ d }: { d: CaseDetail }) {
  const runs = [...new Set(d.toolCalls.map((t) => t.run_no))];
  const [run, setRun] = useState(d.latestRun);
  const plan = d.plans.find((p) => p.run_no === run);
  const calls = d.toolCalls.filter((t) => t.run_no === run);
  return (
    <div>
      <div className="trace-head">
        <p className="muted">Planner <strong>{plan?.planner}</strong>{plan?.model ? ` (${plan.model})` : ''}, prompt {plan?.prompt_version}. Each step was checked by the gateway before any record was read.</p>
        {runs.length > 1 && <select value={run} onChange={(e) => setRun(Number(e.target.value))} aria-label="Investigation run">{runs.map((r) => <option key={r} value={r}>Run {r}</option>)}</select>}
      </div>
      <ol className="trace">
        {calls.map((t) => (
          <li key={t.id} className={`step step-${t.decision.toLowerCase()}`}>
            <div className="step-head"><span className="step-n">{t.seq}</span><code className="tool">{t.tool}</code><Pill value={t.decision} /><span className="muted">{t.duration_ms} ms</span></div>
            <p className="step-why">{t.rationale}</p>
            <div className="step-io">
              <code className="args">{JSON.stringify(t.args)}</code>
              {t.decision === 'ALLOWED' ? <span>→ {t.result_summary}</span> : <span className="deny">→ {t.deny_reason}</span>}
            </div>
            {t.source_refs.length > 0 && <div className="refs">{t.source_refs.map((r) => <span key={r.id} className="ref">{r.id} v{r.version} <Hash value={r.hash} /></span>)}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Rules({ d }: { d: CaseDetail }) {
  const plan = d.plans[0];
  return (
    <div className="table-scroll">
      <table className="table table-static">
        <thead><tr><th>Rule</th><th>Outcome</th><th>Result</th><th>Sources</th></tr></thead>
        <tbody>
          {plan.rule_results.map((r) => (
            <tr key={r.ruleId}>
              <td><strong>{r.ruleId} {r.name}</strong><small>v{r.version}</small></td>
              <td><Pill value={r.outcome} /></td>
              <td>{r.detail}<details><summary>Inputs</summary><pre>{JSON.stringify(r.facts, null, 2)}</pre></details></td>
              <td className="muted">{r.sources.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fineprint pad">Rules are versioned code ({d.proposals[0]?.policy_version ?? 'AP-DISCOUNT'}). Integer minor units and calendar-day arithmetic; no floating point, no model involvement.</p>
    </div>
  );
}

function ProposalView({ d }: { d: CaseDetail }) {
  if (!d.proposals.length) return <Empty title="No proposal">Rules did not all pass, so nothing was proposed. See the decision panel for the reason.</Empty>;
  return (
    <div className="stack">
      {d.proposals.map((p) => {
        const ex = d.executions.filter((e) => e.proposal_id === p.id);
        const ap = d.approvals.filter((a) => a.proposal_id === p.id);
        return (
          <div key={p.id} className="proposal">
            <div className="proposal-head"><strong>{p.id}</strong><Pill value={p.status} /><span className="muted">Run {p.run_no}, proposed by {p.proposed_by_name}, {dateTime(p.created_at)}</span></div>
            <div className="cols-2">
              <div><h3>Payload</h3><Binding p={p} /></div>
              <div>
                <h3>Evidence manifest</h3>
                <table className="table table-static compact"><thead><tr><th>Record</th><th>Version</th><th>Hash</th></tr></thead>
                  <tbody>{p.evidence_manifest.map((m) => <tr key={m.id}><td>{m.id} <small>{m.table}</small></td><td>v{m.version}</td><td><Hash value={m.hash} /></td></tr>)}</tbody></table>
              </div>
            </div>
            {ap.map((a) => <p key={a.id} className={`callout callout-${a.decision === 'APPROVED' ? 'good' : 'warn'}`}>{a.decision === 'APPROVED' ? 'Approved' : 'Rejected'} by {a.approver_name} at {dateTime(a.decided_at)}{a.reason ? `: “${a.reason}”` : ''}. Expires {dateTime(a.expires_at)}.</p>)}
            {ex.map((e) => (
              <div key={e.id} className="exec">
                <div className="proposal-head"><strong>{e.id}</strong><Pill value={e.status} /><span className="muted">Idempotency key <Hash value={e.idempotency_key} /></span></div>
                {e.error && <p className="callout callout-bad">{e.error}</p>}
                {d.verifications.filter((v) => v.execution_id === e.id).map((v) => (
                  <div key={v.id}>
                    <h3>Independent verification</h3>
                    <ul className="checks">{v.checks.map((ck) => <li key={ck.id} className={ck.passed ? 'ok' : 'bad'}><Pill value={ck.passed ? 'PASS' : 'FAIL'} /> {ck.label} <span className="muted">actual: {JSON.stringify(ck.actual)}</span></li>)}</ul>
                    {v.guidance && <p className="callout callout-warn">{v.guidance}</p>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function AuditList({ d }: { d: CaseDetail }) {
  const download = async () => {
    const data = await api(`/cases/${d.case.id}/export`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${d.case.id}-audit-export.json`; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <div>
      <div className="trace-head"><p className="muted">{d.audit.length} events for this case, part of the global hash chain.</p>{d.viewer.canExportAudit && <button className="btn btn-quiet" onClick={download}><Download size={14} /> Export audit bundle</button>}</div>
      <ol className="events">
        {d.audit.map((a) => (
          <li key={a.id}><span className="muted num">{time(a.created_at)}</span><Pill value={a.event_type.includes('DENIED') || a.event_type.includes('FAILED') ? 'DENIED' : a.event_type.includes('FLAG') ? 'FLAGGED' : 'neutral'} label={humanize(a.event_type)} />
            <span>{a.summary}</span><span className="muted">{a.actor_id}</span></li>
        ))}
      </ol>
    </div>
  );
}
