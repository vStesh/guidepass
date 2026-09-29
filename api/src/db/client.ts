import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { drizzle as drizzleDataApi } from "drizzle-orm/aws-data-api/pg";
import { migrate as migrateDataApi } from "drizzle-orm/aws-data-api/pg/migrator";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema.ts";

// oxlint-disable-next-line no-explicit-any -- both drivers share this type, only the query-result type differs
export type Db = PgDatabase<any, typeof schema>;

export interface DataApiConfig {
  resourceArn: string;
  secretArn: string;
  database: string;
}

/**
 * Aurora Serverless v2 through the Data API: no VPC or NAT needed in Lambda.
 *
 * A paused database answers the first calls with DatabaseResumingException for
 * up to ~15 s while it wakes up; calls are retried until `resumeWaitMs` runs out.
 * The API keeps this under API Gateway's 29 s limit; migrations can wait longer.
 */
export function createDataApiDb(config: DataApiConfig, options: { resumeWaitMs?: number } = {}): Db {
  const client = new RDSDataClient({});
  retryWhileResuming(client, options.resumeWaitMs ?? 22_000);
  return drizzleDataApi(client, { ...config, schema });
}

export function isResuming(err: unknown): boolean {
  for (let e = err as { name?: unknown; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.name === "DatabaseResumingException") return true;
  }
  return false;
}

/** Wraps `client.send` so every Data API call waits for a paused database to resume. */
export function retryWhileResuming(
  client: { send: (...args: never[]) => Promise<unknown> },
  maxWaitMs: number,
  sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
): void {
  const send = client.send.bind(client) as (...args: unknown[]) => Promise<unknown>;
  client.send = (async (...args: unknown[]) => {
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        return await send(...args);
      } catch (err) {
        const delay = Math.min(1000 * 2 ** attempt, 5000);
        if (!isResuming(err) || waited + delay > maxWaitMs) throw err;
        await sleep(delay);
        waited += delay;
      }
    }
  }) as typeof client.send;
}

export async function migrateDataApiDb(db: Db, migrationsFolder: string): Promise<void> {
  // oxlint-disable-next-line no-explicit-any -- the migrator wants the driver-specific type
  await migrateDataApi(db as any, { migrationsFolder });
}

export interface EnvironmentSeed {
  key: string;
  name: string;
}

export const defaultEnvironments: EnvironmentSeed[] = [
  { key: "dev", name: "Development" },
  { key: "stg", name: "Staging" },
  { key: "prod", name: "Production" },
];

/** Fills the environments table on first deploy; later edits are made in the app. */
export async function seedEnvironments(db: Db, seed: EnvironmentSeed[]): Promise<void> {
  const existing = await db.select().from(schema.environments).limit(1);
  if (existing.length) return;
  await db
    .insert(schema.environments)
    .values(seed.map((env, position) => ({ ...env, position })));
}
