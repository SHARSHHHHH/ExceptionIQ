import type { DB } from '../db';
import { clock } from '../config';
import { DomainError } from '../domain/types';
import { newId } from '../util';
import type { SourceRecord } from '../tools/sources';

export type NodeType = 'Case' | 'SourceRecord' | 'Clause' | 'Finding' | 'RuleResult' | 'Proposal' | 'Approval' | 'Action' | 'Verification';
export type EdgeType = 'supports' | 'contradicts' | 'derived_from' | 'evaluated_by' | 'authorized_by' | 'verified_by' | 'proposes' | 'executes';

/**
 * Evidence Graph writer. Invariants (idea doc §6):
 *  - a SourceRecord node always carries source table, version, content hash and the tool-call ID that retrieved it;
 *  - a Finding marked SUPPORTED must link to at least one existing source/clause node in the same case;
 *  - edges may only reference nodes of the same case (suggested links are validated, never trusted).
 */
export class EvidenceGraph {
  private sourceNodeByKey = new Map<string, string>();
  constructor(private db: DB, private caseId: string, private runNo: number) {}

  node(type: NodeType, label: string, extra: { refId?: string; status?: string; data?: Record<string, unknown> } = {}): string {
    const id = newId('N');
    this.db.prepare(`INSERT INTO graph_nodes (id, case_id, run_no, type, label, ref_id, status, data, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, this.caseId, this.runNo, type, label, extra.refId ?? null, extra.status ?? null, JSON.stringify(extra.data ?? {}), clock.now().toISOString());
    return id;
  }

  source(record: SourceRecord, toolCallId: string): string {
    const key = `${record.table}:${record.id}`;
    const existing = this.sourceNodeByKey.get(key);
    if (existing) return existing;
    const id = newId('N');
    this.db.prepare(`INSERT INTO graph_nodes (id, case_id, run_no, type, label, ref_id, source_table, source_version, content_hash, tool_call_id, data, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, this.caseId, this.runNo, 'SourceRecord', `${record.kind} ${record.id}`, record.id, record.table,
      record.version, record.hash, toolCallId, JSON.stringify(record.data), clock.now().toISOString());
    this.sourceNodeByKey.set(key, id);
    return id;
  }

  sourceNodeFor(table: string, id: string): string | undefined {
    return this.sourceNodeByKey.get(`${table}:${id}`);
  }

  finding(label: string, status: 'SUPPORTED' | 'CONTRADICTED' | 'FLAGGED' | 'UNSUPPORTED', supporting: string[], data: Record<string, unknown> = {}): string {
    const valid = supporting.filter((n) => this.exists(n));
    if (status === 'SUPPORTED' && valid.length === 0) {
      throw new DomainError('UNSUPPORTED_FINDING', `Finding "${label}" cannot be SUPPORTED without a retrievable source reference`, 500);
    }
    const id = this.node('Finding', label, { status, data });
    for (const n of valid) this.edge(n, id, status === 'CONTRADICTED' ? 'contradicts' : 'supports');
    return id;
  }

  edge(from: string, to: string, type: EdgeType): void {
    if (!this.exists(from) || !this.exists(to)) throw new DomainError('INVALID_EDGE', `Edge ${from}→${to} references a node outside case ${this.caseId}`, 500);
    this.db.prepare('INSERT INTO graph_edges VALUES (?,?,?,?,?,?)').run(newId('E'), this.caseId, from, to, type, clock.now().toISOString());
  }

  private exists(nodeId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM graph_nodes WHERE id=? AND case_id=?').get(nodeId, this.caseId);
  }
}

/** Attach a node to the latest run's graph from outside the investigator (approval, execution, verification). */
export function attachToCaseGraph(db: DB, caseId: string, type: NodeType, label: string, linkFromType: NodeType, edgeType: EdgeType,
  extra: { refId?: string; status?: string; data?: Record<string, unknown> } = {}): string | null {
  const run = db.prepare('SELECT MAX(run_no) AS r FROM graph_nodes WHERE case_id=?').get(caseId) as { r: number | null };
  if (run.r === null) return null;
  const from = db.prepare('SELECT id FROM graph_nodes WHERE case_id=? AND run_no=? AND type=? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get(caseId, run.r, linkFromType) as { id: string } | undefined;
  const g = new EvidenceGraph(db, caseId, run.r);
  const id = g.node(type, label, extra);
  if (from) g.edge(from.id, id, edgeType);
  return id;
}
