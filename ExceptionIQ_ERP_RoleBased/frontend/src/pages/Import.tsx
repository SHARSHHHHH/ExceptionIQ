import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSearch, FileUp, Sparkles, Wand2 } from 'lucide-react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useApi, useToast } from '../hooks';
import { Empty, ErrorState, Loading, PageHead, Panel, Pill, Toast } from '../components/ui';
import { dateTime, EXCEPTION_LABEL, money, toMinor } from '../format';

const HEADER = 'external_id,value_date,amount,currency,counterparty,reference,beneficiary_account';
interface Row { external_id: string; value_date: string; amount: string; currency: string; counterparty: string; reference: string; beneficiary_account: string }
interface Parsed { engine: 'csv' | 'openai'; model: string | null; rows: Row[]; warnings: string[]; invalid: { line: number; error: string }[] }
interface Outcome { line: number; external_id: string; bank_txn_id?: string; outcome: string; detail: string; case_id?: string; exception_type?: string; investigation?: { status: string; outcome: string } }
interface Batch { id: string; entity_id: string; imported_by_name: string; source: string; rows_total: number; auto_matched: number; cases_created: number; duplicates: number; rejected: number; created_at: string }
interface LedgerItem { id: string; invoice_id: string; vendor_name: string; invoice_date: string; expected_minor: number; currency: string; has_discount_terms: number }

const OUTCOME_TONE: Record<string, string> = { AUTO_MATCHED: 'PASS', CASE_CREATED: 'INFO', DUPLICATE: 'SUPERSEDED', REJECTED: 'FAIL' };

export function Import() {
  const { session, can } = useAuth();
  const entities = session!.user.entityIds;
  const [entity, setEntity] = useState(entities[0]);
  const currency = entity === 'SG01' ? 'SGD' : 'INR';
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [auto, setAuto] = useState(can('case:investigate'));
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Outcome[] | null>(null);
  const { toast, show } = useToast();
  const ledger = useApi<{ items: LedgerItem[] }>(`/ingest/ledger?entity=${entity}`);
  const batches = useApi<{ batches: Batch[] }>('/ingest/batches');
  const ai = session!.ai;

  const step = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); } catch (e) { show((e as ApiError).message, 'bad'); } finally { setBusy(null); }
  };
  const loadSample = () => step('sample', async () => {
    const r = await api<{ csv: string }>(`/ingest/sample?entity=${entity}`);
    setText(r.csv); setParsed(null); setResult(null); ledger.reload();
  });
  const preview = () => step('preview', async () => { setResult(null); setParsed(await api<Parsed>('/ingest/parse', { method: 'POST', body: { text, currency } })); });
  const doImport = () => step('import', async () => {
    if (!parsed) return;
    const r = await api<{ outcomes: Outcome[]; batch: Batch }>('/ingest/statement', { method: 'POST',
      body: { entityId: entity, rows: parsed.rows, autoInvestigate: auto, source: parsed.engine === 'openai' ? 'AI_PARSED' : 'CSV' } });
    setResult(r.outcomes); setParsed(null);
    show(`${r.batch.auto_matched} auto-matched, ${r.batch.cases_created} exception case(s), ${r.batch.duplicates} duplicate(s), ${r.batch.rejected} rejected`);
    ledger.reload(); batches.reload();
  });
  const bad = new Set(parsed?.invalid.map((x) => x.line));

  return <>
    <PageHead title="Import bank statement" lede="Exact payments to a verified beneficiary clear automatically with no journal (policy AUTO-MATCH@1.0.0). Every other line becomes a classified exception case that goes through the governed flow." />
    <div className="split split-wide">
      <Panel title="1 · Statement" action={entities.length > 1 ? <select value={entity} onChange={(e) => { setEntity(e.target.value); setParsed(null); setResult(null); }} aria-label="Entity">{entities.map((e) => <option key={e}>{e}</option>)}</select> : <span className="muted">{entity}</span>}>
        <p className="fineprint">Paste CSV with the header <code>{HEADER}</code>, or {ai.enabled ? <>any bank e-mail or remittance text: <strong>{ai.model}</strong> will extract the lines for you to review.</> : <>enable the AI parser by adding <code>OPENAI_API_KEY</code> to <code>backend/.env.local</code> to paste free-form text.</>}</p>
        <textarea className="stmt" rows={11} value={text} onChange={(e) => { setText(e.target.value); setParsed(null); }} placeholder={`${HEADER}\nUTR0001,2026-09-30,125000.00,${currency},Vendor name,NEFT/VENDOR/INV2001,50200010100101`} spellCheck={false} />
        <div className="btn-row">
          <button className="btn btn-quiet" disabled={!!busy} onClick={loadSample}><Wand2 size={14} /> {busy === 'sample' ? 'Building…' : 'Load sample from live ledger'}</button>
          <button className="btn btn-primary" disabled={!!busy || !text.trim()} onClick={preview}>{ai.enabled ? <Sparkles size={14} /> : <FileSearch size={14} />} {busy === 'preview' ? 'Reading…' : 'Preview lines'}</button>
        </div>
      </Panel>
      <Panel title="Unpaid ledger" flush>
        {ledger.loading && !ledger.data ? <Loading /> : ledger.error ? <ErrorState message={ledger.error.message} onRetry={ledger.reload} /> : !ledger.data!.items.length ? <Empty title="No unpaid invoices">The sample builder adds new invoices from the ERP feed when it runs out.</Empty> :
          <div className="table-scroll ledger-scroll"><table className="table table-static compact">
            <thead><tr><th>Invoice</th><th>Vendor</th><th className="r">Amount</th><th>Terms</th></tr></thead>
            <tbody>{ledger.data!.items.map((i) => <tr key={i.id}><td><strong>{i.invoice_id}</strong><small>{i.invoice_date}</small></td><td>{i.vendor_name}</td><td className="r num">{money(i.expected_minor, i.currency)}</td><td>{i.has_discount_terms ? '2% / 10 days' : 'Net 30'}</td></tr>)}</tbody>
          </table></div>}
      </Panel>
    </div>

    {parsed && <Panel title={`2 · Review ${parsed.rows.length} line(s)`} action={<span className="muted">{parsed.engine === 'openai' ? `Extracted by ${parsed.model} — check every line` : 'Parsed as CSV'}</span>} flush>
      {parsed.warnings.map((w, i) => <p key={i} className="callout callout-warn pad">{w}</p>)}
      <div className="table-scroll"><table className="table table-static compact">
        <thead><tr><th>#</th><th>External id</th><th>Value date</th><th className="r">Amount</th><th>Counterparty</th><th>Reference</th><th>Beneficiary</th><th>Check</th></tr></thead>
        <tbody>{parsed.rows.map((r, i) => <tr key={i} className={bad.has(i + 1) ? 'row-bad' : ''}>
          <td className="muted">{i + 1}</td><td>{r.external_id}</td><td>{r.value_date}</td><td className="r num">{toMinor(r.amount) === null ? r.amount : money(toMinor(r.amount), r.currency)}</td>
          <td>{r.counterparty}</td><td className="muted">{r.reference}</td><td className="muted">{r.beneficiary_account ? `••••${r.beneficiary_account.slice(-4)}` : '—'}</td>
          <td>{bad.has(i + 1) ? <span className="bad-text">{parsed.invalid.find((x) => x.line === i + 1)?.error}</span> : <Pill value="PASS" label="OK" />}</td></tr>)}</tbody>
      </table></div>
      <div className="import-foot">
        {can('case:investigate') ? <label className="check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-investigate new exception cases (they will be assigned to you)</label>
          : <span className="muted">New cases are left unassigned for an analyst to pick up.</span>}
        <button className="btn btn-primary" disabled={!!busy || !parsed.rows.length} onClick={doImport}><FileUp size={14} /> {busy === 'import' ? (auto ? 'Importing and investigating…' : 'Importing…') : `Import ${parsed.rows.length - bad.size} valid line(s)`}</button>
      </div>
      {bad.size > 0 && <p className="fineprint pad">Invalid lines are rejected individually and recorded in the batch; valid lines still import.</p>}
    </Panel>}

    {result && <Panel title="3 · Result" flush>
      <div className="table-scroll"><table className="table table-static compact">
        <thead><tr><th>#</th><th>External id</th><th>Outcome</th><th>Detail</th><th>Case</th><th>Investigation</th></tr></thead>
        <tbody>{result.map((o) => <tr key={o.line}>
          <td className="muted">{o.line}</td><td>{o.external_id}<small>{o.bank_txn_id}</small></td>
          <td><Pill value={OUTCOME_TONE[o.outcome] ?? o.outcome} label={o.outcome === 'CASE_CREATED' ? EXCEPTION_LABEL[o.exception_type ?? ''] ?? 'Exception' : o.outcome.replace('_', ' ').toLowerCase()} /></td>
          <td>{o.detail}</td><td>{o.case_id ? <Link className="link" to={`/cases/${o.case_id}`}>{o.case_id}</Link> : '—'}</td>
          <td>{o.investigation ? <Pill value={o.investigation.status} /> : <span className="muted">—</span>}</td></tr>)}</tbody>
      </table></div>
    </Panel>}

    <Panel title="Recent imports" flush>
      {batches.loading && !batches.data ? <Loading /> : batches.error ? <ErrorState message={batches.error.message} onRetry={batches.reload} /> : !batches.data!.batches.length ? <Empty title="No statements imported yet" /> :
        <div className="table-scroll"><table className="table table-static compact">
          <thead><tr><th>Batch</th><th>When</th><th>By</th><th>Source</th><th className="r">Lines</th><th className="r">Auto-matched</th><th className="r">Cases</th><th className="r">Duplicates</th><th className="r">Rejected</th></tr></thead>
          <tbody>{batches.data!.batches.map((b) => <tr key={b.id}><td>{b.id}<small>{b.entity_id}</small></td><td className="nowrap">{dateTime(b.created_at)}</td><td>{b.imported_by_name}</td><td>{b.source}</td>
            <td className="r num">{b.rows_total}</td><td className="r num good-text">{b.auto_matched}</td><td className="r num">{b.cases_created}</td><td className="r num">{b.duplicates}</td><td className="r num">{b.rejected}</td></tr>)}</tbody>
        </table></div>}
    </Panel>
    <Toast toast={toast} />
  </>;
}
