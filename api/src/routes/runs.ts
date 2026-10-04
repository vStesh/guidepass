import { appliesTo, looksLikeSecret, needsEvidence } from "@guidepass/schema";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireMembership, type AppEnv } from "../context.ts";
import { apps, attachments, guideVersions, guides, results, runs } from "../db/schema.ts";
import { ApiError } from "../errors.ts";
import { announceRunProblems } from "../services/notifications.ts";
import { countRun, getGuideResults, loadGuide } from "../services/results.ts";
import { attachmentKey, attachmentsOf, reservedCount, uploadedCount } from "../services/attachments.ts";
import { evidenceTypes, MAX_EVIDENCE_BYTES, MAX_EVIDENCE_FILES } from "../storage.ts";
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
    z
      .object({
        environment: z.string().min(1),
        platform,
        device: z.string().trim().min(1).max(100),
        build: z.string().trim().max(60).optional(),
        commit: z.string().trim().max(60).optional(),
        account: z.string().trim().max(100).optional(),
      })
      .refine((b) => b.build || b.commit, { message: "Give the build or the commit you are testing.", path: ["build"] }),
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
        build: body.build || null,
        commit: body.commit || null,
        account: body.account || null,
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
    return c.json(await getGuideResults(c.var.db, guide, app, c.req.valid("query"), c.var.evidence));
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
  const shots = await attachmentsOf(c.var.db, c.var.evidence, [row.run.id]);
  const scenarioShots = Object.fromEntries(
    [...shots].map(([id, list]) => [id.slice(row.run.id.length + 1), list]),
  );
  return c.json({
    run: { ...row.run, version: row.version, guideId: row.guideId },
    app: row.app,
    content: row.content,
    results: rows,
    attachments: scenarioShots,
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
      status: z.enum(["pass", "fail", "blocked", "skip", "untested"]),
      note: z.string().trim().max(2000).optional(),
      evidence: z.string().trim().max(4000).optional(),
      issueUrl: z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(500)]).optional(),
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

    const { status, note, evidence, issueUrl } = c.req.valid("json");
    const where = and(eq(results.runId, runId), eq(results.scenarioKey, scenarioKey));
    if (status === "untested") {
      await c.var.db.delete(results).where(where);
      return c.json({ result: null });
    }
    // Notes and proof are shown to the team and to agents: no secrets in them.
    if ([evidence, note, issueUrl].some((text) => text && looksLikeSecret(text))) {
      throw new ApiError("invalid", "This looks like it contains a token or key. Cut secrets out before saving.", {
        reason: "secret_in_evidence",
      });
    }
    // An omitted field keeps the existing value; an empty one clears it.
    const [existing] = await c.var.db.select().from(results).where(where);
    const nextEvidence = evidence !== undefined ? evidence || null : (existing?.evidence ?? null);
    // A screenshot counts as proof as well as text does.
    if (needsEvidence(scenario, status) && !nextEvidence && !(await uploadedCount(c.var.db, runId, scenarioKey))) {
      throw new ApiError(
        "invalid",
        status === "fail" ? "A fail needs proof." : "This scenario needs proof for a pass.",
        { reason: "evidence_required" },
      );
    }
    const fields = {
      ...(note !== undefined ? { note: note || null } : {}),
      ...(evidence !== undefined ? { evidence: evidence || null } : {}),
      ...(issueUrl !== undefined ? { issueUrl: issueUrl || null } : {}),
    };
    const [result] = await c.var.db
      .insert(results)
      .values({ runId, scenarioKey, status, ...fields })
      .onConflictDoUpdate({
        target: [results.runId, results.scenarioKey],
        set: { status, updatedAt: new Date(), ...fields },
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
    const finished = c.req.valid("json").finished;
    // Finishing only updates a run that isn't finished yet, so a double tap
    // (or a retried request) finishes it, and notifies, exactly once.
    const [changed] = await c.var.db
      .update(runs)
      .set({ finishedAt: finished ? new Date() : null })
      .where(and(eq(runs.id, row.run.id), finished ? isNull(runs.finishedAt) : isNotNull(runs.finishedAt)))
      .returning();
    const run = changed ?? row.run;
    if (finished && changed) {
      const rows = await c.var.db.select().from(results).where(eq(results.runId, row.run.id));
      await announceRunProblems(c.var.notifications, {
        appId: row.app.id,
        guideId: row.guideId,
        guideTitle: row.content.title,
        runId: row.run.id,
        tester: c.var.user.name ?? c.var.user.email.split("@")[0]!,
        environment: row.run.environmentKey,
        platform: row.run.platform,
        device: row.run.device,
        counts: countRun(row.content, row.run.environmentKey, row.run.platform, rows),
      });
    }
    return c.json({ run });
  },
);

/** The caller's own open run, or an error: only the tester marks and attaches, until they finish. */
async function ownOpenRun(c: Parameters<typeof requireMembership>[0], runId: string) {
  const row = await loadRun(c, runId);
  if (row.run.testerId !== c.var.user.id) throw new ApiError("forbidden", "You can only change your own runs.");
  if (row.run.finishedAt) throw new ApiError("conflict", "This run is finished. Reopen it to change results.");
  return row;
}

function storageOf(c: Parameters<typeof requireMembership>[0]) {
  if (!c.var.evidence) throw new ApiError("not_found", "Screenshots aren't set up on this instance.");
  return c.var.evidence;
}

/**
 * Start attaching a screenshot to a scenario of your run: returns a short-lived
 * form the browser posts the file to (S3 checks its key, type and size), then
 * call `.../complete`.
 */
runRoutes.post(
  "/runs/:runId/results/:scenarioKey/attachments",
  validate("param", z.object({ runId: z.uuid(), scenarioKey: z.string().min(1) })),
  validate("json", z.object({ contentType: z.enum(evidenceTypes) })),
  async (c) => {
    const storage = storageOf(c);
    const { runId, scenarioKey } = c.req.valid("param");
    const row = await ownOpenRun(c, runId);
    const scenario = row.content.scenarios.find((s) => s.key === scenarioKey);
    if (!scenario || !appliesTo(scenario, row.run.environmentKey, row.run.platform)) {
      throw new ApiError("invalid", `Scenario ${scenarioKey} does not apply to this run.`);
    }
    if ((await reservedCount(c.var.db, runId, scenarioKey)) >= MAX_EVIDENCE_FILES) {
      throw new ApiError("conflict", `A result can have up to ${MAX_EVIDENCE_FILES} screenshots.`, { reason: "too_many_files" });
    }
    const { contentType } = c.req.valid("json");
    const [attachment] = await c.var.db.insert(attachments).values({ runId, scenarioKey, contentType }).returning();
    const upload = await storage.presignUpload(attachmentKey(runId, attachment!.id), contentType);
    return c.json({ attachment: { id: attachment!.id }, upload, maxBytes: MAX_EVIDENCE_BYTES }, 201);
  },
);

/** Confirms the browser's upload: the file must be there, of the declared type and size. */
runRoutes.post(
  "/attachments/:attachmentId/complete",
  validate("param", z.object({ attachmentId: z.uuid() })),
  async (c) => {
    const storage = storageOf(c);
    const [attachment] = await c.var.db.select().from(attachments).where(eq(attachments.id, c.req.valid("param").attachmentId));
    if (!attachment) throw new ApiError("not_found", "Screenshot not found.");
    await ownOpenRun(c, attachment.runId);
    const key = attachmentKey(attachment.runId, attachment.id);
    const object = await storage.head(key);
    if (!object) throw new ApiError("invalid", "The file hasn't been uploaded.", { reason: "not_uploaded" });
    if (object.size > MAX_EVIDENCE_BYTES || object.contentType !== attachment.contentType) {
      await storage.remove(key);
      throw new ApiError("invalid", "The file isn't an image of the allowed size.");
    }
    // The limit is checked again here: several uploads may have been started at once.
    if (!attachment.uploadedAt && (await uploadedCount(c.var.db, attachment.runId, attachment.scenarioKey)) >= MAX_EVIDENCE_FILES) {
      await storage.remove(key);
      await c.var.db.delete(attachments).where(eq(attachments.id, attachment.id));
      throw new ApiError("conflict", `A result can have up to ${MAX_EVIDENCE_FILES} screenshots.`, { reason: "too_many_files" });
    }
    const [done] = await c.var.db
      .update(attachments)
      .set({ size: object.size, uploadedAt: new Date() })
      .where(eq(attachments.id, attachment.id))
      .returning();
    return c.json({
      attachment: { id: done!.id, contentType: done!.contentType, size: done!.size, url: await storage.viewUrl(key) },
    });
  },
);

/** Removes a screenshot from your open run. */
runRoutes.delete(
  "/attachments/:attachmentId",
  validate("param", z.object({ attachmentId: z.uuid() })),
  async (c) => {
    const storage = storageOf(c);
    const [attachment] = await c.var.db.select().from(attachments).where(eq(attachments.id, c.req.valid("param").attachmentId));
    if (!attachment) throw new ApiError("not_found", "Screenshot not found.");
    const row = await ownOpenRun(c, attachment.runId);
    const scenario = row.content.scenarios.find((s) => s.key === attachment.scenarioKey);
    await c.var.db.transaction(async (tx) => {
      // The scenario's screenshots stay locked until this commits, so two removals
      // at once can't both take the last proof away.
      const uploaded = await tx
        .select({ id: attachments.id })
        .from(attachments)
        .where(
          and(
            eq(attachments.runId, attachment.runId),
            eq(attachments.scenarioKey, attachment.scenarioKey),
            isNotNull(attachments.uploadedAt),
          ),
        )
        .for("update");
      const [result] = await tx
        .select()
        .from(results)
        .where(and(eq(results.runId, attachment.runId), eq(results.scenarioKey, attachment.scenarioKey)));
      const isLastProof =
        !!result && !result.evidence && !!attachment.uploadedAt && !!scenario && needsEvidence(scenario, result.status) && uploaded.length <= 1;
      if (isLastProof) {
        throw new ApiError("invalid", "This is the only proof of the result. Add another or change the status first.", {
          reason: "evidence_required",
        });
      }
      await tx.delete(attachments).where(eq(attachments.id, attachment.id));
    });
    // The file goes after the row, so a failure never leaves a row pointing at nothing.
    await storage.remove(attachmentKey(attachment.runId, attachment.id));
    return c.json({ removed: attachment.id });
  },
);

