import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import * as schema from './schema.js';

export type AppDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: AppDb;
  ping(): Promise<void>;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
const PGLITE_PREFIX = 'pglite://';

const openPostgres = async (url: string): Promise<Database> => {
  const { default: pg } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5_000,
  });
  // An idle client that loses its connection emits 'error'; unhandled, it would end the process.
  pool.on('error', () => undefined);
  const db = drizzle({ client: pool, schema });
  return {
    db,
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    migrate: () => migrate(db, { migrationsFolder }),
    close: () => pool.end(),
  };
};

// PGlite is Postgres compiled to WASM. It serves tests and local runs without Docker.
const openPglite = async (location: string): Promise<Database> => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = new PGlite(location === 'memory' ? undefined : location);
  const db = drizzle({ client, schema });
  return {
    db,
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    migrate: () => migrate(db, { migrationsFolder }),
    close: () => client.close(),
  };
};

export const openDatabase = (url: string): Promise<Database> =>
  url.startsWith(PGLITE_PREFIX)
    ? openPglite(url.slice(PGLITE_PREFIX.length))
    : openPostgres(url);
