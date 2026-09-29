import { fileURLToPath } from "node:url";
import { required } from "./config.ts";
import {
  createDataApiDb,
  defaultEnvironments,
  migrateDataApiDb,
  seedEnvironments,
  type EnvironmentSeed,
} from "./db/client.ts";

/**
 * Invoked by Terraform after each deploy: applies migrations, then seeds the
 * environments on the very first deploy.
 *
 * The build bundles this file as `dist/migrate.mjs` and copies `api/migrations`
 * to `dist/migrations`, which is what this path points to at runtime.
 */
export async function handler(event: { environments?: EnvironmentSeed[] }) {
  const db = createDataApiDb(
    {
      resourceArn: required("DB_CLUSTER_ARN"),
      secretArn: required("DB_SECRET_ARN"),
      database: required("DB_NAME"),
    },
    // Runs from Terraform with a 5-minute timeout, so it can wait out a slow resume.
    { resumeWaitMs: 120_000 },
  );
  await migrateDataApiDb(db, fileURLToPath(new URL("./migrations", import.meta.url)));
  await seedEnvironments(db, event.environments?.length ? event.environments : defaultEnvironments);
  return { ok: true };
}
