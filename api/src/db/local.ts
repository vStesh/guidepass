import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.ts";
import type { Db } from "./client.ts";

const migrationsFolder = fileURLToPath(new URL("../../migrations", import.meta.url));

/** Postgres inside Node for local development and tests. Pass no path for an in-memory database. */
export async function createLocalDb(dataDir?: string): Promise<Db> {
  const db = drizzle(new PGlite(dataDir), { schema });
  await migrate(db, { migrationsFolder });
  return db;
}

/**
 * Tests: an empty, migrated database for each test. One database per test file
 * (tests in a file run one after another) is emptied between tests, which is
 * much faster than migrating a new one every time.
 */
let shared: Promise<{ db: Db; tables: string[] }> | undefined;

export async function createTestDb(): Promise<Db> {
  shared ??= (async () => {
    const db = await createLocalDb();
    const result = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
    const rows = (result as unknown as { rows: { tablename: string }[] }).rows;
    return { db, tables: rows.map((r) => `"${r.tablename}"`) };
  })();
  const { db, tables } = await shared;
  await db.execute(sql.raw(`truncate ${tables.join(", ")} restart identity cascade`));
  return db;
}
