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

/** Aurora Serverless v2 through the Data API: no VPC or NAT needed in Lambda. */
export function createDataApiDb(config: DataApiConfig): Db {
  return drizzleDataApi(new RDSDataClient({}), { ...config, schema });
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
