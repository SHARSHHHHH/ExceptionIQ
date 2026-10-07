import type { CaseStatus } from '../types';

const PATH: { key: CaseStatus; label: string; owner: string }[] = [
  { key:'OPEN', label:'Opened', owner:'System' },
  { key:'INVESTIGATING', label:'Investigate', owner:'Analyst' },
  { key:'AWAITING_APPROVAL', label:'Propose', owner:'Analyst' },
  { key:'APPROVED', label:'Approve', owner:'Controller' },
  { key:'EXECUTING', label:'Execute', owner:'Executor' },
  { key:'VERIFYING', label:'Verify', owner:'Verifier' },
  { key:'CLOSED', label:'Close', owner:'System' },
];

export function Lifecycle({ status, reachedApproval, executed }: { status: CaseStatus; reachedApproval: boolean; executed: boolean }) {
  const off = status === 'NEEDS_REVIEW' || status === 'BLOCKED';
  const idx = off ? (executed ? 4 : reachedApproval ? 2 : 1) : PATH.findIndex((p) => p.key === status);
  return <ol className="lifecycle" aria-label="Governed case lifecycle">
    {PATH.map((p,i)=>{
      const state = i < idx || (status==='CLOSED' && i===idx) ? 'done' : i===idx ? (off?'stopped':'current') : 'todo';
      return <li key={p.key} className={`lc lc-${state}`} title={`${p.label} · ${p.owner}`}><span className="lc-dot">{i+1}</span><span><strong>{state==='stopped' ? (status==='BLOCKED'?'Blocked':'Review') : p.label}</strong><small>{p.owner}</small></span></li>;
    })}
  </ol>;
}
