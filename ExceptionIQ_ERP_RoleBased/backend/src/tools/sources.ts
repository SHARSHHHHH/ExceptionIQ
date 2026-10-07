import type { DB } from '../db';
import { hashOf, parseJson } from '../util';
import { maskAccount } from '../security/redaction';

/**
 * Read adapters over the MOCK enterprise systems. Every record is returned with its
 * table, id, version and a content hash so evidence can be bound to an exact record state.
 */
export interface SourceRecord {
  table: string;
  id: string;
  version: number;
  hash: string;
  kind: 'BankTransaction' | 'OpenItem' | 'Invoice' | 'PurchaseOrder' | 'Vendor' | 'Contract' | 'PaymentMatch';
  data: Record<string, unknown>;
}

function rec(table: string, kind: SourceRecord['kind'], row: Record<string, unknown> | undefined, transform?: (r: Record<string, unknown>) => Record<string, unknown>): SourceRecord | null {
  if (!row) return null;
  const { version, updated_at: _u, ...rest } = row;
  const data = transform ? transform(rest) : rest;
  return { table, kind, id: String(row.id), version: Number(version ?? 1), hash: hashOf({ table, data: rest, version }), data };
}

export const sources = {
  bankTransaction(db: DB, id: string, entityId: string) {
    return rec('bank_transactions', 'BankTransaction', db.prepare('SELECT * FROM bank_transactions WHERE id=? AND entity_id=?').get(id, entityId) as Record<string, unknown>);
  },
  openItemsForVendor(db: DB, vendorId: string, entityId: string, includeCleared: boolean, limit: number) {
    const rows = db.prepare(`SELECT * FROM erp_open_items WHERE vendor_id=? AND entity_id=? ${includeCleared ? '' : "AND status='OPEN'"} ORDER BY id LIMIT ?`)
      .all(vendorId, entityId, limit) as Record<string, unknown>[];
    return rows.map((r) => rec('erp_open_items', 'OpenItem', r)!);
  },
  matchesForInvoices(db: DB, invoiceIds: string[], entityId: string) {
    if (invoiceIds.length === 0) return [];
    const rows = db.prepare(`SELECT *, 1 AS version FROM payment_matches WHERE entity_id=? AND invoice_id IN (${invoiceIds.map(() => '?').join(',')})`)
      .all(entityId, ...invoiceIds) as Record<string, unknown>[];
    return rows.map((r) => rec('payment_matches', 'PaymentMatch', r)!);
  },
  matchesForBankTxn(db: DB, bankTxnId: string) {
    return db.prepare('SELECT * FROM payment_matches WHERE bank_txn_id=?').all(bankTxnId) as Record<string, unknown>[];
  },
  invoice(db: DB, id: string, entityId: string) {
    return rec('invoices', 'Invoice', db.prepare('SELECT * FROM invoices WHERE id=? AND entity_id=?').get(id, entityId) as Record<string, unknown>);
  },
  purchaseOrder(db: DB, id: string, entityId: string) {
    return rec('purchase_orders', 'PurchaseOrder', db.prepare('SELECT * FROM purchase_orders WHERE id=? AND entity_id=?').get(id, entityId) as Record<string, unknown>);
  },
  vendor(db: DB, id: string, entityId: string) {
    // Identity is returned with the beneficiary account MASKED. The fingerprint is a one-way comparison key.
    return rec('vendors', 'Vendor', db.prepare('SELECT * FROM vendors WHERE id=? AND entity_id=?').get(id, entityId) as Record<string, unknown>,
      (r) => ({ ...r, beneficiary_ref: maskAccount(String(r.beneficiary_ref)) }));
  },
  effectiveContract(db: DB, vendorId: string, entityId: string, asOf: string) {
    const row = db.prepare(`SELECT * FROM contracts WHERE vendor_id=? AND entity_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)
      ORDER BY effective_from DESC LIMIT 1`).get(vendorId, entityId, asOf, asOf) as Record<string, unknown> | undefined;
    return rec('contracts', 'Contract', row, (r) => ({ ...r, approved_terms: parseJson(r.approved_terms as string, null) }));
  },
  /** Re-read a record by (table, id) for evidence-freshness checks. */
  reread(db: DB, table: string, id: string): { version: number; hash: string } | null {
    const allowed = ['bank_transactions', 'erp_open_items', 'invoices', 'purchase_orders', 'vendors', 'contracts', 'payment_matches'];
    if (!allowed.includes(table)) return null;
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const withVersion = table === 'payment_matches' ? { ...row, version: 1 } : row;
    const { version, updated_at: _u, ...rest } = withVersion;
    return { version: Number(version), hash: hashOf({ table, data: rest, version }) };
  },
};
