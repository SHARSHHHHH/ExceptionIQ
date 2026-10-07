import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Activity, CheckCircle2, ClipboardList, FileUp, FlaskConical, Gauge, Inbox, LogOut, ScrollText, ShieldCheck, Sparkles, UsersRound, Wrench } from 'lucide-react';
import { useAuth } from '../auth';
import { ROLE_LABEL, money } from '../format';
import type { Role } from '../types';

interface Item { to: string; label: string; icon: LucideIcon; perm: string }
interface Group { group: string; items: Item[] }

/** Each role gets its own workspace. Items are additionally filtered by the permissions the server granted. */
const NAV: Record<Role, Group[]> = {
  ANALYST: [
    { group: 'Reconciliation', items: [
      { to: '/cases?filter=mine', label: 'My work', icon: ClipboardList, perm: 'case:read' },
      { to: '/cases', label: 'Exception queue', icon: Inbox, perm: 'case:read' },
      { to: '/import', label: 'Import bank statement', icon: FileUp, perm: 'ingest:statement' },
    ] },
    { group: 'Reference', items: [
      { to: '/controls', label: 'Rules & policy', icon: ShieldCheck, perm: 'catalog:read' },
      { to: '/tools', label: 'Agent tool boundaries', icon: Wrench, perm: 'tools:read' },
    ] },
  ],
  CONTROLLER: [
    { group: 'Finance control', items: [
      { to: '/approvals', label: 'Approval inbox', icon: CheckCircle2, perm: 'approval:decide' },
      { to: '/cases', label: 'All exceptions', icon: Inbox, perm: 'case:read' },
      { to: '/import', label: 'Import bank statement', icon: FileUp, perm: 'ingest:statement' },
    ] },
    { group: 'Assurance', items: [
      { to: '/audit', label: 'Audit trail', icon: ScrollText, perm: 'audit:read' },
      { to: '/controls', label: 'Policy & authority', icon: ShieldCheck, perm: 'catalog:read' },
    ] },
  ],
  AUDITOR: [
    { group: 'Assurance', items: [
      { to: '/cases', label: 'Case population', icon: Inbox, perm: 'case:read' },
      { to: '/audit', label: 'Audit trail', icon: ScrollText, perm: 'audit:read' },
    ] },
    { group: 'Control design', items: [
      { to: '/controls', label: 'Controls & SoD', icon: ShieldCheck, perm: 'catalog:read' },
      { to: '/tools', label: 'Agent tool boundaries', icon: Wrench, perm: 'tools:read' },
    ] },
  ],
  ADMIN: [
    { group: 'Administration', items: [
      { to: '/users', label: 'Users & roles', icon: UsersRound, perm: 'admin:users' },
      { to: '/replay', label: 'Scenario lab & AI', icon: FlaskConical, perm: 'admin:reset' },
    ] },
    { group: 'Oversight', items: [
      { to: '/cases', label: 'All cases', icon: Inbox, perm: 'case:read' },
      { to: '/audit', label: 'Audit trail', icon: ScrollText, perm: 'audit:read' },
      { to: '/controls', label: 'Controls & RBAC', icon: ShieldCheck, perm: 'catalog:read' },
      { to: '/tools', label: 'Tool registry', icon: Wrench, perm: 'tools:read' },
    ] },
  ],
};

const CONTEXT: Record<Role, string> = { ANALYST: 'Exception operations', CONTROLLER: 'Financial controls', AUDITOR: 'Independent assurance (read-only)', ADMIN: 'Platform administration' };

export function Layout() {
  const { session, signOut, can } = useAuth();
  const u = session!.user;
  const groups = NAV[u.role].map((g) => ({ ...g, items: g.items.filter((i) => can(i.perm)) })).filter((g) => g.items.length);
  const ai = session!.ai;
  const loc = useLocation();
  const all = groups.flatMap((g) => g.items);
  // NavLink ignores the query string; match it explicitly so "My work" and "Exception queue" highlight correctly.
  const isActive = (to: string) => {
    const [path, query] = to.split('?');
    if (query) return loc.pathname === path && loc.search === `?${query}`;
    const queryTwin = all.some((i) => i.to.startsWith(`${path}?`) && loc.search === `?${i.to.split('?')[1]}`);
    return !queryTwin && (loc.pathname === path || loc.pathname.startsWith(`${path}/`));
  };
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Exception<span>IQ</span><small>Finance Exception ERP</small></div>
        <div className="workspace-role">
          <span className={`role-chip role-${u.role.toLowerCase()}`}>{ROLE_LABEL[u.role]}</span>
          <strong>{u.name}</strong>
          {u.title && <span>{u.title}</span>}
          {u.role === 'CONTROLLER' && <span className="limit-line">Approval limit {money(u.approvalLimitMinor ?? 0, u.entityIds[0] === 'SG01' ? 'SGD' : 'INR')}</span>}
        </div>
        <nav aria-label="Main">
          <div className="nav-group">
            <div className="nav-group-title">Workspace</div>
            <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Gauge size={16} /><span>My workspace</span></NavLink>
          </div>
          {groups.map((g) => <div key={g.group} className="nav-group"><div className="nav-group-title">{g.group}</div>
            {g.items.map(({ to, label, icon: Icon }) => <Link key={to} to={to} className={`nav-item ${isActive(to) ? 'active' : ''}`} aria-current={isActive(to) ? 'page' : undefined}><Icon size={16} /><span>{label}</span></Link>)}</div>)}
        </nav>
        <div className="sidebar-foot"><p>Synthetic finance data. Ledger writes are mocked, approval-gated and independently verified.</p><button className="nav-item" onClick={signOut}><LogOut size={16} /> Sign out</button></div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-context"><Activity size={15} /><span>{CONTEXT[u.role]}</span></div>
          <div className="whoami">
            <span className={`ai-chip ${ai.enabled ? 'ai-on' : 'ai-off'}`} title={ai.reason}><Sparkles size={13} />{ai.enabled ? `AI: ${ai.model}` : 'AI: deterministic mode'}</span>
            <span className="entity-badge">Entities: {u.entityIds.join(', ')}</span>
          </div>
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}
