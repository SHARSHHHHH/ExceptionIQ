import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks';
import { ErrorState, Hash, Loading, PageHead, Panel, Pill } from '../components/ui';
import { dateTime, humanize } from '../format';
import type { AuditEvent } from '../types';

export function Audit() {
  const { data, error, loading, reload } = useApi<{ chain: { valid: boolean; checked: number; brokenAtSeq: number | null; headHash: string }; events: AuditEvent[] }>('/audit?limit=500');
  const [type, setType] = useState('');
  const types = useMemo(() => [...new Set((data?.events ?? []).map((e) => e.event_type))].sort(), [data]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  const rows = data!.events.filter((e) => !type || e.event_type === type);
  return (
    <>
      <PageHead title="Audit log" lede="Append-only and hash-chained. Each event's hash covers its content and the previous event's hash, so edits, deletions and reordering are detectable." />
      <div className={`callout callout-${data!.chain.valid ? 'good' : 'bad'} chain-banner`}>
        {data!.chain.valid ? <>Chain verified across all {data!.chain.checked} events. Head <Hash value={data!.chain.headHash} /></> : <>Chain broken at event #{data!.chain.brokenAtSeq}. Treat the log as compromised from that point.</>}
      </div>
      <div className="toolbar">
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by event type">
          <option value="">All event types</option>{types.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
        </select>
        <span className="muted">{rows.length} shown (newest first)</span>
      </div>
      <Panel flush>
        <div className="table-scroll">
          <table className="table table-static">
            <thead><tr><th>#</th><th>When</th><th>Event</th><th>Summary</th><th>Actor</th><th>Case</th><th>Hash</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id}>
                <td className="num muted">{e.seq}</td><td className="nowrap">{dateTime(e.created_at)}</td>
                <td><Pill value={/DENIED|FAILED/.test(e.event_type) ? 'DENIED' : /FLAG/.test(e.event_type) ? 'FLAGGED' : 'neutral'} label={humanize(e.event_type)} /></td>
                <td>{e.summary}</td><td className="muted">{e.actor_id}<small>{humanize(e.actor_role)}</small></td>
                <td>{e.case_id ? <Link className="link" to={`/cases/${e.case_id}`}>{e.case_id}</Link> : '—'}</td>
                <td><Hash value={e.hash} /></td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
