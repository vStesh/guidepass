import { appliesTo } from "@guidepass/schema";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireMembership, type AppEnv } from "../context.ts";
import { apps, guideVersions, guides, results, runs } from "../db/schema.ts";
import { ApiError } from "../errors.ts";
import { countRun, getGuideResults, loadGuide } from "../services/results.ts";
import { validate } from "../validate.ts";

export const runRoutes = new Hono<AppEnv>();

const guideParam = validate("param", z.object({ guideId: z.uuid() }));
const runParam = validate("param", z.object({ runId: z.uuid() }));
const platform = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(30);

/** Start testing the current version of a guide in one environment, on one platform and device. */
runRoutes.post(
  "/guides/:guideId/runs",
  guideParam,
  validate(
    "json",
    z.object({ environment: z.string().min(1), platform, device: z.string().trim().min(1).max(100) }),
  ),
  async (c) => {
    const { teamId } = await requireMembership(c);
    const { guide, app } = await loadGuide(c.var.db, teamId, c.req.valid("param").guideId);
    const body = c.req.valid("json");

    if (guide.status !== "active") throw new ApiError("invalid", "This guide is archived.");
    if (!guide.environments.includes(body.environment)) {
      throw new ApiError("invalid", `This guide is not run on ${body.environment}.`, {
        environments: guide.environments,
      });
    }
    if (!app.platforms.includes(body.platform)) {
      throw new ApiError("invalid", `This app has no ${body.platform} build.`, { platforms: app.platforms });
    }

    const [version] = await c.var.db
      .select({ id: guideVersions.id })
      .from(guideVersions)
      .where(and(eq(guideVersions.guideId, guide.id), eq(guideVersions.version, guide.currentVersion)));
    const [run] = await c.var.db
      .insert(runs)
      .values({
        guideVersionId: version!.id,
        testerId: c.var.user.id,
        environmentKey: body.environment,
        platform: body.platform,
        device: body.device,
      })
      .returning();
    return c.json({ run: { ...run, version: guide.currentVersion } }, 201);
  },
);

/** Everyone's results for a guide version, per environment and platform. */
runRoutes.get(
  "/guides/:guideId/results",
  guideParam,
  validate(
    "query",
    z.object({
      version: z.coerce.number().int().min(1).max(2_147_483_647).optional(),
      environment: z.string().optional(),
      platform: platform.optional(),
      testerId: z.string().optional(),
      filter: z.enum(["problems", "all"]).default("problems"),
    }),
  ),
  async (c) => {
    const { teamId } = await requireMembership(c);
    const { guide, app } = await loadGuide(c.var.db, teamId, c.req.valid("param").guideId);
    return c.json(await getGuideResults(c.var.db, guide, app, c.req.valid("query")));
  },
);

/** A run of a team member, with its guide version and results. */
async function loadRun(c: Parameters<typeof requireMembership>[0], runId: string) {
  const { teamId } = await requireMembership(c);
  const [row] = await c.var.db
    .select({
      run: runs,
      version: guideVersions.version,
      content: guideVersions.content,
      guideId: guides.id,
      app: { id: apps.id, name: apps.name, platforms: apps.platforms, platformNames: apps.platformNames },
    })
    .from(runs)
    .innerJoin(guideVersions, eq(guideVersions.id, runs.guideVersionId))
    .innerJoin(guides, eq(guides.id, guideVersions.guideId))
    .innerJoin(apps, eq(apps.id, guides.appId))
    .where(and(eq(runs.id, runId), eq(apps.teamId, teamId)));
  if (!row) throw new ApiError("not_found", "Run not found.");
  return row;
}

runRoutes.get("/runs/:runId", runParam, async (c) => {
  const row = await loadRun(c, c.req.valid("param").runId);
  const rows = await c.var.db.select().from(results).where(eq(results.runId, row.run.id));
  return c.json({
    run: { ...row.run, version: row.version, guideId: row.guideId },
    app: row.app,
    content: row.content,
    results: rows,
    counts: countRun(row.content, row.run.environmentKey, row.run.platform, rows),
  });
});

/** Mark one scenario in your own run. `untested` clears the mark. */
runRoutes.put(
  "/runs/:runId/results/:scenarioKey",
  validate("param", z.object({ runId: z.uuid(), scenarioKey: z.string().min(1) })),
  validate(
    "json",
    z.object({
      status: z.enum(["pass", "fail", "skip", "untested"]),
      note: z.string().trim().max(2000).optional(),
    }),
  ),
  async (c) => {
    const { runId, scenarioKey } = c.req.valid("param");
    const row = await loadRun(c, runId);
    if (row.run.testerId !== c.var.user.id) throw new ApiError("forbidden", "You can only mark your own runs.");
    if (row.run.finishedAt) throw new ApiError("conflict", "This run is finished. Reopen it to change results.");

    const scenario = row.content.scenarios.find((s) => s.key === scenarioKey);
    if (!scenario) throw new ApiError("not_found", `Scenario ${scenarioKey} is not in this guide version.`);
    if (!appliesTo(scenario, row.run.environmentKey, row.run.platform)) {
      throw new ApiError("invalid", `Scenario ${scenarioKey} does not apply to this run.`);
    }

    const { status, note } = c.req.valid("json");
    const where = and(eq(results.runId, runId), eq(results.scenarioKey, scenarioKey));
    if (status === "untested") {
      await c.var.db.delete(results).where(where);
      return c.json({ result: null });
    }
    // An omitted note keeps the existing one; an empty note clears it.
    const [result] = await c.var.db
      .insert(results)
      .values({ runId, scenarioKey, status, note: note || null })
      .onConflictDoUpdate({
        target: [results.runId, results.scenarioKey],
        set: { status, updatedAt: new Date(), ...(note !== undefined ? { note: note || null } : {}) },
      })
      .returning();
    return c.json({ result });
  },
);

/** Finish your run, or reopen it to change results. */
runRoutes.patch(
  "/runs/:runId",
  runParam,
  validate("json", z.object({ finished: z.boolean() })),
  async (c) => {
    const row = await loadRun(c, c.req.valid("param").runId);
    if (row.run.testerId !== c.var.user.id) throw new ApiError("forbidden", "You can only change your own runs.");
    const [run] = await c.var.db
      .update(runs)
      .set({ finishedAt: c.req.valid("json").finished ? new Date() : null })
      .where(eq(runs.id, row.run.id))
      .returning();
    return c.json({ run });
  },
);
