import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Lock, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { humanize, shortHash, STATUS_LABEL, tone } from '../format';
import type { CaseStatus } from '../types';

export function Pill({ value, label }: { value?: string | null; label?: string }) {
  if (!value) return null;
  const text = label ?? (value in STATUS_LABEL ? STATUS_LABEL[value as CaseStatus] : humanize(value));
  return <span className={`pill pill-${tone(value)}`}>{text}</span>;
}

export function Panel({ title, action, children, className = '', flush }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`panel ${className}`}>
      {title && <header className="panel-head"><h2>{title}</h2>{action}</header>}
      <div className={flush ? '' : 'panel-body'}>{children}</div>
    </section>
  );
}

export function PageHead({ title, lede, actions }: { title: string; lede?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{lede && <p>{lede}</p>}</div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export const Hash = ({ value, label }: { value?: string | null; label?: string }) =>
  <code className="hash" title={value ?? ''}>{label ? `${label} ` : ''}{shortHash(value)}</code>;

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return <div className="state"><Loader2 className="spin" size={18} /> {text}</div>;
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="state state-bad"><XCircle size={18} /> <span>{message}</span>{onRetry && <button className="btn btn-quiet" onClick={onRetry}>Try again</button>}</div>;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><strong>{title}</strong>{children && <span>{children}</span>}</div>;
}
export function Toast({ toast }: { toast: { text: string; tone: 'good' | 'bad' } | null }) {
  if (!toast) return null;
  return <div className={`toast toast-${toast.tone}`} role="status">{toast.tone === 'good' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}{toast.text}</div>;
}
export function KV({ k, v }: { k: string; v: ReactNode }) {
  return <div className="kv"><dt>{k}</dt><dd>{v}</dd></div>;
}

export function NoAccess({ perm }: { perm: string }) {
  return <div className="empty no-access"><Lock size={20} /><strong>Your role cannot open this screen</strong>
    <span>It requires the <code>{perm}</code> permission. Access is decided by your role on the server, not by this page.</span>
    <Link className="btn btn-quiet" to="/">Back to my workspace</Link></div>;
}
