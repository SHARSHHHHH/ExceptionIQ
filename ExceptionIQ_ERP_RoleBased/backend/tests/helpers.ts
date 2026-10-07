import type { SQLInputValue } from 'node:sqlite';
import { createDatabase, useDatabase, type DB } from '../src/db';
import { DEMO_USERS, SCENARIOS } from '../src/fixtures/scenarios';
import { Actor } from '../src/domain/types';
import { setPlannerForTesting } from '../src/agent';
import { ScriptedPlanner } from '../src/agent/scriptedPlanner';
import { resetClock } from '../src/config';

export function freshDb(): DB {
  resetClock();
  setPlannerForTesting(new ScriptedPlanner({ simulateCompromise: true }));
  return useDatabase(createDatabase(':memory:'));
}

export function actor(id: string): Actor {
  const u = DEMO_USERS.find((x) => x.id === id)!;
  return { id: u.id, name: u.name, role: u.role, entityIds: [...u.entityIds], approvalLimitMinor: u.approvalLimitMinor, title: u.title };
}
export const asha = () => actor('U-ASHA');      // IN01 analyst
export const karan = () => actor('U-KARAN');    // IN01 analyst
export const ravi = () => actor('U-RAVI');      // IN01 controller
export const lim = () => actor('U-LIM');        // SG01 analyst
export const tan = () => actor('U-TAN');        // SG01 controller
export const dev = () => actor('U-DEV');        // admin
export const meera = () => actor('U-MEERA');    // IN01 senior controller (high limit)
export const nisha = () => actor('U-NISHA');    // auditor (read-only)

export const caseFor = (key: string) => {
  const s = SCENARIOS.find((x) => x.key === key)!;
  return `CASE-${s.ids.bank.replace('B-', '')}`;
};

export const count = (db: DB, sql: string, ...args: SQLInputValue[]) => (db.prepare(sql).get(...args) as { n: number }).n;
