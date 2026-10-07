import { useMemo, useState } from 'react';
import type { GraphEdge, GraphNode } from '../types';
import { shortHash, tone } from '../format';
import { Pill } from './ui';

/**
 * Chain-of-custody view of the Evidence Graph. Columns run left→right from source records to verification.
 * Selecting a node highlights everything upstream of it, so an auditor can trace a closed case back to its sources.
 */
const COLUMNS: { types: string[]; title: string }[] = [
  { types: ['SourceRecord'], title: 'Source records' },
  { types: ['Clause', 'Finding'], title: 'Clauses & findings' },
  { types: ['RuleResult'], title: 'Deterministic rules' },
  { types: ['Proposal', 'Approval', 'Action', 'Verification'], title: 'Decision chain' },
];
const TYPE_LABEL: Record<string, string> = { RuleResult: 'Rule', Clause: 'Clause', Finding: 'Finding', Proposal: 'Proposal', Approval: 'Approval', Action: 'Action', Verification: 'Verification' };
const W = 150, H = 46, GAP_X = 34, GAP_Y = 12, TOP = 34;

export function EvidenceGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const visible = nodes.filter((n) => n.type !== 'Case');
  const [selected, setSelected] = useState<string | null>(() => {
    const v = visible.filter((n) => n.type === 'Verification').pop() ?? visible.filter((n) => n.type === 'Proposal').pop();
    return v?.id ?? null;
  });

  const layout = useMemo(() => {
    const order = (n: GraphNode) => COLUMNS[3].types.indexOf(n.type);
    const cols = COLUMNS.map((c, i) => ({ ...c, nodes: visible.filter((n) => c.types.includes(n.type)).sort((a, b) => (i === 3 ? order(a) - order(b) : 0)) }))
      .filter((c) => c.nodes.length);
    const maxRows = Math.max(1, ...cols.map((c) => c.nodes.length));
    const height = TOP + maxRows * (H + GAP_Y) + 10;
    const pos = new Map<string, { x: number; y: number }>();
    cols.forEach((c, ci) => {
      const colH = c.nodes.length * (H + GAP_Y) - GAP_Y;
      const offset = TOP + (height - TOP - 10 - colH) / 2;
      c.nodes.forEach((n, ri) => pos.set(n.id, { x: ci * (W + GAP_X) + 4, y: offset + ri * (H + GAP_Y) }));
    });
    return { cols, pos, width: cols.length * (W + GAP_X) - GAP_X + 8, height };
  }, [visible]);

  const drawn = edges.filter((e) => layout.pos.has(e.from_id) && layout.pos.has(e.to_id));
  const upstream = useMemo(() => {
    const set = new Set<string>();
    if (!selected) return set;
    const byTo = new Map<string, string[]>();
    for (const e of drawn) byTo.set(e.to_id, [...(byTo.get(e.to_id) ?? []), e.from_id]);
    const stack = [selected];
    while (stack.length) { const n = stack.pop()!; if (set.has(n)) continue; set.add(n); stack.push(...(byTo.get(n) ?? [])); }
    return set;
  }, [selected, drawn]);

  const sel = visible.find((n) => n.id === selected) ?? null;
  if (!visible.length) return <p className="muted">The graph appears after the first investigation run.</p>;

  return (
    <div className="graph-wrap">
      <p className="graph-hint">Select any node to trace it back to its sources. Highlighted: {upstream.size} of {visible.length} nodes.</p>
      <div className="graph-scroll">
        <svg width={layout.width} height={layout.height} role="img" aria-label="Evidence graph">
          <defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#14222e" /></marker></defs>
          {layout.cols.map((c, i) => (
            <text key={c.title} x={i * (W + GAP_X) + 4} y={16} className="graph-col">{c.title}</text>
          ))}
          {drawn.map((e) => {
            const a = layout.pos.get(e.from_id)!, b = layout.pos.get(e.to_id)!;
            const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
            const on = upstream.has(e.from_id) && upstream.has(e.to_id);
            const sameColumn = a.x === b.x;
            const d = sameColumn
              ? `M${a.x + W / 2},${a.y + H} L${b.x + W / 2},${b.y}`
              : `M${x1},${y1} C${x1 + GAP_X / 2},${y1} ${x2 - GAP_X / 2},${y2} ${x2},${y2}`;
            return <path key={e.id} d={d} className={`edge edge-${e.type} ${sameColumn ? 'edge-chain' : ''} ${on ? 'edge-on' : selected ? 'edge-dim' : ''}`} markerEnd={sameColumn ? 'url(#arrow)' : undefined} />;
          })}
          {visible.map((n) => {
            const p = layout.pos.get(n.id);
            if (!p) return null;
            const t = n.type === 'SourceRecord' ? 'source' : tone(n.status);
            const dim = selected && !upstream.has(n.id);
            return (
              <g key={n.id} transform={`translate(${p.x},${p.y})`} className={`node node-${t} ${n.id === selected ? 'node-sel' : ''} ${dim ? 'node-dim' : ''}`}
                onClick={() => setSelected(n.id)} tabIndex={0} role="button" aria-pressed={n.id === selected}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setSelected(n.id); } }}>
                <rect width={W} height={H} rx={n.type === 'SourceRecord' ? 2 : 8} />
                <text x={10} y={18} className="node-type">{n.type === 'SourceRecord' ? `${String(n.source_table).replace(/_/g, ' ')} · v${n.source_version}` : TYPE_LABEL[n.type] ?? n.type}</text>
                <text x={10} y={35} className="node-label">{trim(n.label.replace(/^(BankTransaction|OpenItem|Invoice|PurchaseOrder|Vendor|Contract|PaymentMatch) /, ''), 20)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      {sel && <NodeDetail node={sel} />}
    </div>
  );
}

function NodeDetail({ node }: { node: GraphNode }) {
  const data = node.data ?? {};
  const facts = (data as { facts?: Record<string, unknown> }).facts;
  return (
    <div className="node-detail">
      <div className="node-detail-head"><strong>{node.label}</strong><Pill value={node.status ?? (node.type === 'SourceRecord' ? 'RETRIEVED' : null)} /></div>
      <dl className="grid-kv">
        <div className="kv"><dt>Node type</dt><dd>{TYPE_LABEL[node.type] ?? 'Source record'}</dd></div>
        {node.ref_id && <div className="kv"><dt>Reference</dt><dd>{node.ref_id}</dd></div>}
        {node.source_table && <div className="kv"><dt>Source</dt><dd>{node.source_table} · version {node.source_version}</dd></div>}
        {node.content_hash && <div className="kv"><dt>Content hash</dt><dd><code className="hash">{shortHash(node.content_hash)}</code></dd></div>}
        {node.tool_call_id && <div className="kv"><dt>Retrieved by</dt><dd><code className="hash">{node.tool_call_id}</code></dd></div>}
        <div className="kv"><dt>Recorded</dt><dd>{new Date(node.created_at).toLocaleString()}</dd></div>
      </dl>
      {'detail' in data && <p className="node-detail-text">{String(data.detail)}</p>}
      <details><summary>{facts ? 'Rule inputs and outputs' : 'Record content'}</summary><pre>{JSON.stringify(facts ?? data, null, 2)}</pre></details>
    </div>
  );
}

const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
