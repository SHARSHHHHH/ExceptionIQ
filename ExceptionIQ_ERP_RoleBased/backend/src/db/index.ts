import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA, SCHEMA_VERSION } from './schema';
import { seedDatabase } from '../fixtures/seed';
import { config } from '../config';

export type DB = DatabaseSync;

/**
 * Run fn inside a SQLite transaction: COMMIT on success, ROLLBACK on any error.
 * Uses Node's built-in node:sqlite (no native build step, so `npm ci` works on any machine).
 */
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function removeDbFiles(file: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = path.resolve(file + suffix);
    if (fs.existsSync(f)) fs.rmSync(f);
  }
}

export function createDatabase(file: string, opts: { seed?: boolean } = { seed: true }): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  let db = new DatabaseSync(file);
  // A database file from an older ExceptionIQ version has a different schema. It only holds synthetic demo
  // data, so rebuild it instead of failing later with "no such column" errors.
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  const hasTables = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='entities'").get();
  if (file !== ':memory:' && hasTables && version !== SCHEMA_VERSION) {
    console.warn(`[exceptioniq] Demo database schema v${version} is outdated (current v${SCHEMA_VERSION}); rebuilding ${file}.`);
    db.close();
    removeDbFiles(file);
    db = new DatabaseSync(file);
  }
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  const empty = (db.prepare('SELECT COUNT(*) AS n FROM entities').get() as { n: number }).n === 0;
  if (empty && opts.seed !== false) seedDatabase(db);
  return db;
}

// Survive Next.js hot reloads in development.
const g = globalThis as unknown as { __exceptioniqDb?: DB };

export function getDb(): DB {
  if (!g.__exceptioniqDb) g.__exceptioniqDb = createDatabase(config.databasePath);
  return g.__exceptioniqDb;
}

/** Swap the active database (tests, demo reset). */
export function useDatabase(db: DB): DB {
  g.__exceptioniqDb = db;
  return db;
}

/** Drop and recreate all demo data in the active file. Audit history is recreated too — demo only. */
export function resetDemoDatabase(): DB {
  const file = config.databasePath;
  g.__exceptioniqDb?.close();
  g.__exceptioniqDb = undefined;
  removeDbFiles(file);
  return getDb();
}
