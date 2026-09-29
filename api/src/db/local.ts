import { PGlite } from "@electric-sql/pglite";
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
