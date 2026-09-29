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
  const db = createDataApiDb({
    resourceArn: required("DB_CLUSTER_ARN"),
    secretArn: required("DB_SECRET_ARN"),
    database: required("DB_NAME"),
  });
  await whileResuming(() =>
    migrateDataApiDb(db, fileURLToPath(new URL("./migrations", import.meta.url))),
  );
  await seedEnvironments(db, event.environments?.length ? event.environments : defaultEnvironments);
  return { ok: true };
}

/** Aurora Serverless v2 paused at zero capacity rejects calls for up to a minute while it resumes. */
async function whileResuming<T>(fn: () => Promise<T>, attempts = 8): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const resuming = (e: unknown): boolean =>
        !!e && ((e as { name?: string }).name === "DatabaseResumingException" || resuming((e as { cause?: unknown }).cause));
      if (attempt >= attempts || !resuming(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
}
