import type { DB } from '../db';
import { clock, config } from '../config';
import { Actor } from '../domain/types';
import { appendAudit } from '../audit/audit';
import { canonicalJson, newId } from '../util';
import { redactDeep } from '../security/redaction';
import { TOOLS, ToolCaller } from './registry';
import { SourceRecord, sources } from './sources';

export interface CaseScopeRow { id: string; entity_id: string; bank_txn_id: string }

export type GatewayResult =
  | { decision: 'ALLOWED'; toolCallId: string; records: SourceRecord[]; summary: string }
  | { decision: 'DENIED' | 'ERROR'; toolCallId: string; records: []; reasonCode: string; reason: string };

/**
 * The single choke point between the planner and enterprise data.
 * Tool names, arguments and record IDs proposed by the model are UNTRUSTED input:
 * every call is checked against the allowlist, caller class, schema, case scope and budget,
 * then logged (allowed or denied) to tool_calls and the audit chain.
 */
export class ToolGateway {
  private seq = 0;
  private allowedCalls = 0;
  readonly evidence = new Map<string, SourceRecord>();
  readonly scope: { entityId: string; bankTxnId: string; vendorIds: Set<string>; invoiceIds: Set<string> };

  constructor(private db: DB, private kase: CaseScopeRow, private runNo: number, private actor: Actor, private initiatedBy: Actor) {
    this.scope = { entityId: kase.entity_id, bankTxnId: kase.bank_txn_id, vendorIds: new Set(), invoiceIds: new Set() };
  }

  get callsUsed() { return this.allowedCalls; }

  call(tool: string, rawArgs: unknown, rationale: string, caller: ToolCaller = 'agent'): GatewayResult {
    const toolCallId = newId('TC');
    const started = Date.now();
    const deny = (reasonCode: string, reason: string, decision: 'DENIED' | 'ERROR' = 'DENIED'): GatewayResult => {
      this.log(toolCallId, tool, rawArgs, rationale, decision, reason, null, [], Date.now() - started);
      this.db.prepare('INSERT INTO denied_actions VALUES (?,?,?,?,?,?,?)')
        .run(newId('DEN'), this.kase.id, this.actor.id, `tool:${tool}`, reasonCode, reason, clock.now().toISOString());
      appendAudit(this.db, {
        caseId: this.kase.id, entityId: this.kase.entity_id, actor: this.actor, type: decision === 'DENIED' ? 'TOOL_CALL_DENIED' : 'TOOL_CALL_ERROR',
        correlationId: toolCallId, summary: `${tool} ${decision.toLowerCase()}: ${reasonCode}`,
        data: { tool, args: rawArgs as Record<string, unknown>, reasonCode, reason, initiatedBy: this.initiatedBy.id },
      });
      return { decision, toolCallId, records: [], reasonCode, reason };
    };

    const contract = TOOLS[tool];
    if (!contract) return deny('TOOL_NOT_ALLOWLISTED', `"${tool}" is not an allowlisted tool. The agent action set is fixed in code.`);
    if (!contract.callers.includes(caller)) return deny('CALLER_NOT_PERMITTED', `${caller} may not invoke ${contract.access} tool ${tool}.`);
    if (this.allowedCalls >= config.budgets.maxToolCalls) return deny('BUDGET_EXHAUSTED', `Tool-call budget of ${config.budgets.maxToolCalls} exhausted.`);
    const parsed = contract.input.safeParse(rawArgs);
    if (!parsed.success) return deny('INVALID_ARGUMENTS', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const args = parsed.data as Record<string, unknown>;

    const scopeError = this.checkScope(tool, args);
    if (scopeError) return deny('SCOPE_VIOLATION', scopeError);

    let records: SourceRecord[];
    try {
      records = this.execute(tool, args);
    } catch (e) {
      return deny('ADAPTER_ERROR', (e as Error).message, 'ERROR');
    }
    this.allowedCalls++;
    for (const r of records) this.evidence.set(`${r.table}:${r.id}`, r);
    this.expandScope(records);
    const summary = records.length ? records.map((r) => `${r.kind} ${r.id} v${r.version}`).join(', ') : 'No matching record';
    this.log(toolCallId, tool, args, rationale, 'ALLOWED', null, summary, records, Date.now() - started);
    appendAudit(this.db, {
      caseId: this.kase.id, entityId: this.kase.entity_id, actor: this.actor, type: 'TOOL_CALL', correlationId: toolCallId,
      summary: `${tool} → ${summary}`,
      data: { tool, args, sources: records.map((r) => ({ table: r.table, id: r.id, version: r.version, hash: r.hash })), initiatedBy: this.initiatedBy.id },
    });
    return { decision: 'ALLOWED', toolCallId, records, summary };
  }

  private checkScope(tool: string, a: Record<string, unknown>): string | null {
    const s = this.scope;
    switch (tool) {
      case 'bank.get_transaction':
        return a.transaction_id === s.bankTxnId ? null : `Transaction ${a.transaction_id} is not bound to case ${this.kase.id}.`;
      case 'erp.get_open_items':
      case 'vendor.get_verified_identity':
      case 'contract.get_effective_terms':
        return s.vendorIds.has(String(a.vendor_id)) ? null : `Vendor ${a.vendor_id} is not linked to this case by retrieved evidence.`;
      case 'invoice.get_with_po':
        return s.invoiceIds.has(String(a.invoice_id)) ? null : `Invoice ${a.invoice_id} is not linked to this case by an ERP open item.`;
      default:
        return null;
    }
  }

  private execute(tool: string, a: Record<string, unknown>): SourceRecord[] {
    const e = this.scope.entityId;
    switch (tool) {
      case 'bank.get_transaction':
        return compact([sources.bankTransaction(this.db, String(a.transaction_id), e)]);
      case 'erp.get_open_items': {
        const items = sources.openItemsForVendor(this.db, String(a.vendor_id), e, Boolean(a.include_cleared), Number(a.limit));
        const matches = sources.matchesForInvoices(this.db, items.map((i) => String(i.data.invoice_id)), e);
        return [...items, ...matches];
      }
      case 'invoice.get_with_po': {
        const inv = sources.invoice(this.db, String(a.invoice_id), e);
        const po = inv?.data.po_id ? sources.purchaseOrder(this.db, String(inv.data.po_id), e) : null;
        return compact([inv, po]);
      }
      case 'vendor.get_verified_identity':
        return compact([sources.vendor(this.db, String(a.vendor_id), e)]);
      case 'contract.get_effective_terms':
        return compact([sources.effectiveContract(this.db, String(a.vendor_id), e, String(a.as_of_date))]);
      default:
        throw new Error(`No adapter for ${tool}`);
    }
  }

  private expandScope(records: SourceRecord[]) {
    for (const r of records) {
      if (r.kind === 'BankTransaction' && r.data.vendor_hint) this.scope.vendorIds.add(String(r.data.vendor_hint));
      if (r.kind === 'OpenItem') this.scope.invoiceIds.add(String(r.data.invoice_id));
      if (r.kind === 'Invoice') this.scope.vendorIds.add(String(r.data.vendor_id));
    }
  }

  private log(id: string, tool: string, args: unknown, rationale: string, decision: string, denyReason: string | null,
    summary: string | null, records: SourceRecord[], ms: number) {
    this.db.prepare(`INSERT INTO tool_calls (id, case_id, run_no, seq, tool, actor, args, rationale, decision, deny_reason, result_summary, source_refs, duration_ms, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, this.kase.id, this.runNo, ++this.seq, tool, this.actor.id, canonicalJson(redactDeep(args ?? {})), rationale.slice(0, 600),
      decision, denyReason, summary, JSON.stringify(records.map((r) => ({ table: r.table, id: r.id, version: r.version, hash: r.hash }))), ms,
      clock.now().toISOString());
  }
}

const compact = <T>(xs: (T | null)[]): T[] => xs.filter((x): x is T => x !== null);
