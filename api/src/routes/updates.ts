import { Hono } from "hono";
import { z } from "zod";
import { requireMembership, type AppEnv } from "../context.ts";
import { eq } from "drizzle-orm";
import { instanceState } from "../db/schema.ts";
import { ApiError } from "../errors.ts";
import { getUpdateStatus } from "../services/updates.ts";
import { validate } from "../validate.ts";
import { VERSION } from "../version.ts";

export const updateRoutes = new Hono<AppEnv>();

/** This instance's version. */
updateRoutes.get("/version", async (c) => {
  await requireMembership(c);
  return c.json({ version: VERSION });
});

/** Whether a newer release exists, for owners, who update the instance. */
updateRoutes.get(
  "/updates",
  validate("query", z.object({ refresh: z.enum(["1"]).optional() })),
  async (c) => {
    await requireMembership(c, "owner");
    return c.json(
      await getUpdateStatus(c.var.db, {
        repository: c.var.updates.repository,
        fetch: c.var.updates.fetch,
        refresh: c.req.valid("query").refresh === "1",
        canUpdate: !!c.var.updates.updater,
      }),
    );
  },
);

const RUN_KEY = "update_run";

interface StoredRun {
  id: string;
  version: string;
  from: string;
  startedBy: string;
  startedAt: string;
}

function updaterOf(c: { var: AppEnv["Variables"] }) {
  if (!c.var.updates.updater) throw new ApiError("not_found", "This instance can't update itself (self_update is off).");
  return c.var.updates.updater;
}

async function lastRun(c: { var: AppEnv["Variables"] }): Promise<StoredRun | null> {
  const [row] = await c.var.db.select().from(instanceState).where(eq(instanceState.key, RUN_KEY));
  const run = row?.value as StoredRun | undefined;
  return run?.id ? run : null;
}

/** The last update started from the web app, with its live progress and log. */
updateRoutes.get("/updates/run", async (c) => {
  await requireMembership(c, "owner");
  const updater = updaterOf(c);
  const run = await lastRun(c);
  if (!run) return c.json({ run: null });
  const state = await updater.get(run.id).catch(() => null);
  // Without CodeBuild's answer the outcome is unknown, not failed.
  return c.json({
    run: state
      ? { ...run, ...state, startedAt: state.startedAt ?? run.startedAt }
      : { ...run, status: "unknown", phase: null, log: [] },
  });
});

/**
 * Updates this instance to the newest release: snapshot of the database, then
 * terraform apply of that release (infra/updater/buildspec.yml). Owners only,
 * one at a time, and only to the release the update check found.
 */
updateRoutes.post(
  "/updates/run",
  validate("json", z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/) })),
  async (c) => {
    await requireMembership(c, "owner");
    const updater = updaterOf(c);
    const { version } = c.req.valid("json");
    const status = await getUpdateStatus(c.var.db, { repository: c.var.updates.repository, fetch: c.var.updates.fetch });
    if (!status.updateAvailable || status.latest?.version !== version) {
      throw new ApiError("conflict", `Version ${version} isn't the newest release, or this instance already runs it.`, {
        reason: "not_latest",
      });
    }
    const commit = status.latest.commit;
    if (!commit) {
      throw new ApiError("conflict", "Couldn't find the commit of this release. Check for updates again.", { reason: "no_commit" });
    }
    // The row stays locked while the run starts, so two owners pressing at once start one update.
    await c.var.db.insert(instanceState).values({ key: RUN_KEY, value: {} }).onConflictDoNothing();
    const run = await c.var.db.transaction(async (tx) => {
      const [row] = await tx.select().from(instanceState).where(eq(instanceState.key, RUN_KEY)).for("update");
      const previous = row?.value as StoredRun | undefined;
      if (previous?.id && (await updater.get(previous.id).catch(() => null))?.status === "running") {
        throw new ApiError("conflict", "An update is already running.", { reason: "running" });
      }
      let id: string;
      try {
        ({ id } = await updater.start(version, commit));
      } catch (err) {
        console.warn("Starting the update failed:", err);
        throw new ApiError("conflict", "The update couldn't be started. Try again in a minute.", { reason: "not_started" });
      }
      const next: StoredRun = {
        id,
        version,
        from: VERSION,
        startedBy: c.var.user.name ?? c.var.user.email,
        startedAt: new Date().toISOString(),
      };
      await tx.update(instanceState).set({ value: next, updatedAt: new Date() }).where(eq(instanceState.key, RUN_KEY));
      return next;
    });
    return c.json({ run }, 202);
  },
);

