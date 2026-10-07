import { transaction, type DB } from '../db';
import { SCENARIOS, DEMO_USERS, DEMO_PASSWORD, LEDGER, ScenarioDef } from './scenarios';
import { hashPassword } from '../security/passwords';
import { appendAudit } from '../audit/audit';
import { SERVICE_ACTORS } from '../security/session';
import { sha256 } from '../util';
import { clock } from '../config';

/** One-way beneficiary fingerprint: lets rules compare accounts without exposing them. */
export const fp = (account: string) => sha256(`beneficiary:${account}`).slice(0, 16);

const STD_TERMS = JSON.stringify({ early_payment_discount: { rate_bps: 200, window_days: 10, basis: 'invoice_date' } });
const STD_CLAUSE = 'Clause 7.2 Early payment. Where the Buyer settles an undisputed invoice within 10 (ten) calendar days of the invoice date, ' +
  'the Buyer may deduct a discount of 2% of the invoice base amount, excluding taxes and fees. Clause 7.3 Otherwise payment is due net 30 days.';
const NET30_CLAUSE = 'Clause 6.1 Payment terms. Payment is due net 30 days from invoice date. No early-payment incentives apply.';

export function seedDatabase(db: DB): void {
  const now = clock.now().toISOString();
  transaction(db, () => {
    db.prepare('INSERT INTO entities VALUES (?,?,?)').run('IN01', 'ExceptionIQ Demo India Pvt Ltd', 'INR');
    db.prepare('INSERT INTO entities VALUES (?,?,?)').run('SG01', 'ExceptionIQ Demo Singapore Pte Ltd', 'SGD');
    const pw = hashPassword(DEMO_PASSWORD);
    for (const u of DEMO_USERS) {
      db.prepare('INSERT INTO users (id, email, name, role, entity_ids, password_hash, title, approval_limit_minor, active, updated_at) VALUES (?,?,?,?,?,?,?,?,1,?)')
        .run(u.id, u.email, u.name, u.role, JSON.stringify(u.entityIds), pw, u.title, u.approvalLimitMinor, now);
    }
    for (const s of SCENARIOS) seedScenario(db, s, now);
    seedLedger(db, now);
  });
}

function seedScenario(db: DB, s: ScenarioDef, now: string) {
  const { ids } = s;
  db.prepare(`INSERT INTO vendors VALUES (?,?,?,?,?,1,1,?)`).run(ids.vendor, s.entityId, s.vendorName, s.beneficiaryAccount, fp(s.beneficiaryAccount), now);
  db.prepare(`INSERT INTO purchase_orders VALUES (?,?,?,?,?,'APPROVED',1,?)`).run(ids.po, s.entityId, ids.vendor, s.invoiceMinor, s.currency, now);
  db.prepare(`INSERT INTO contracts VALUES (?,?,?,?,?,?,?,1,?)`).run(
    ids.contract, s.entityId, ids.vendor, '2026-01-01', '2027-03-31', s.clauseText, s.approvedTerms ? JSON.stringify(s.approvedTerms) : null, now);
  db.prepare(`INSERT INTO invoices VALUES (?,?,?,?,?,?,?,?,?,1,?)`).run(
    ids.invoice, s.entityId, ids.vendor, ids.po, ids.contract, s.invoiceDate, s.invoiceMinor, s.invoiceMinor, s.currency, now);

  const benef = s.bankBeneficiaryAccount ?? s.beneficiaryAccount;
  const ref = `NEFT/${s.vendorName.split(' ')[0].toUpperCase()}/${ids.invoice.replace('-', '')}`;
  db.prepare(`INSERT INTO bank_transactions VALUES (?,?,?,?,?,?,?,?,?,1,?)`).run(
    ids.bank, s.entityId, s.paidMinor, s.bankCurrency ?? s.currency, s.valueDate, fp(benef), s.vendorName, ref, ids.vendor, now);

  if (s.alreadySettledBy) {
    db.prepare(`INSERT INTO bank_transactions VALUES (?,?,?,?,?,?,?,?,?,1,?)`).run(
      s.alreadySettledBy, s.entityId, s.paidMinor, s.currency, '2026-09-05', fp(s.beneficiaryAccount), s.vendorName, ref, ids.vendor, now);
    db.prepare(`INSERT INTO erp_open_items VALUES (?,?,?,?,?,?,0,?,'CLEARED',1,1,?)`).run(
      ids.openItem, s.entityId, ids.invoice, ids.vendor, s.invoiceMinor, s.paidMinor, s.currency, now);
    db.prepare(`INSERT INTO payment_matches VALUES (?,?,?,?,?,NULL,?)`).run(`M-${s.alreadySettledBy}`, s.entityId, s.alreadySettledBy, ids.invoice, s.paidMinor, now);
  } else {
    db.prepare(`INSERT INTO erp_open_items VALUES (?,?,?,?,?,?,?,?,'OPEN',0,1,?)`).run(
      ids.openItem, s.entityId, ids.invoice, ids.vendor, s.invoiceMinor, s.paidMinor, s.invoiceMinor - s.paidMinor, s.currency, now);
  }

  const caseId = `CASE-${ids.bank.replace('B-', '')}`;
  db.prepare(`INSERT INTO cases (id, entity_id, scenario, source_event_key, bank_txn_id, title, status, currency, faults, created_by, created_at, updated_at, source, exception_type)
    VALUES (?,?,?,?,?,?, 'OPEN', ?, ?, ?, ?, ?, 'SEEDED', ?)`).run(
    caseId, s.entityId, s.key, `bank.unmatched:${ids.bank}:v1`, ids.bank, `Unmatched payment ${ids.bank} — ${s.vendorName}`,
    s.bankCurrency ?? s.currency, JSON.stringify(s.faults ?? {}), SERVICE_ACTORS.ingest.id, now, now,
    s.alreadySettledBy ? 'DUPLICATE_PAYMENT' : s.bankCurrency ? 'CURRENCY_MISMATCH' : s.bankBeneficiaryAccount ? 'BENEFICIARY_MISMATCH' : 'SHORT_PAYMENT');
  appendAudit(db, {
    caseId, entityId: s.entityId, actor: SERVICE_ACTORS.ingest, type: 'CASE_OPENED',
    summary: `Unmatched-payment event ingested for ${ids.bank}`, data: { sourceEventKey: `bank.unmatched:${ids.bank}:v1`, scenario: s.key },
  });
}

/** Unpaid AP ledger (open items with nothing settled yet) used by bank-statement imports. */
function seedLedger(db: DB, now: string) {
  for (const [entityId, { currency, vendors }] of Object.entries(LEDGER)) {
    for (const v of vendors) {
      const n = v.vendor.replace(/^V-/, '');
      const contractId = `C-${n}`;
      db.prepare(`INSERT INTO vendors VALUES (?,?,?,?,?,1,1,?)`).run(v.vendor, entityId, v.name, v.account, fp(v.account), now);
      db.prepare(`INSERT INTO contracts VALUES (?,?,?,?,?,?,?,1,?)`).run(contractId, entityId, v.vendor, '2026-01-01', '2027-03-31',
        v.terms ? STD_CLAUSE : NET30_CLAUSE, v.terms ? STD_TERMS : null, now);
      for (const i of v.invoices) {
        const num = i.id.replace(/^INV-/, '');
        db.prepare(`INSERT INTO purchase_orders VALUES (?,?,?,?,?,'APPROVED',1,?)`).run(`PO-${num}`, entityId, v.vendor, i.minor, currency, now);
        db.prepare(`INSERT INTO invoices VALUES (?,?,?,?,?,?,?,?,?,1,?)`).run(i.id, entityId, v.vendor, `PO-${num}`, contractId, i.date, i.minor, i.minor, currency, now);
        db.prepare(`INSERT INTO erp_open_items VALUES (?,?,?,?,?,0,?,?,'OPEN',0,1,?)`).run(`OI-${num}`, entityId, i.id, v.vendor, i.minor, i.minor, currency, now);
      }
    }
  }
}
