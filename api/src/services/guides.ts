import { and, eq, inArray } from "drizzle-orm";
import { diffScenarios, validateGuide, type ScenarioDiff } from "@guidepass/schema";
import type { Db } from "../db/client.ts";
import { apps, areas, environments, guideVersions, guides, results, runs } from "../db/schema.ts";
import { ApiError, isUniqueViolation } from "../errors.ts";

export type Author = { userId: string } | { tokenId: string };

export interface UploadGuideInput {
  teamId: string;
  appId: string;
  areaId?: string | null;
  slug: string;
  content: unknown;
  changeNote?: string;
  baseVersion?: number;
  dryRun?: boolean;
  author: Author;
}

export interface UploadGuideResult {
  guideId: string | null;
  version: number;
  dryRun: boolean;
  diff: ScenarioDiff;
}

/** Thrown inside the transaction to roll back a dry run after all checks passed. */
class DryRun {
  constructor(readonly result: UploadGuideResult) {}
}

/**
 * Creates a guide or adds a version. Shared by the web API and the MCP server,
 * so the rules from the MCP design are enforced in one place.
 *
 * Everything from reading the current version to writing the new one happens in
 * one transaction with the guide row locked, so two concurrent uploads with the
 * same `baseVersion` cannot both succeed.
 */
export async function uploadGuide(db: Db, input: UploadGuideInput): Promise<UploadGuideResult> {
  try {
    return await db.transaction((tx) => upload(tx as Db, input));
  } catch (err) {
    if (err instanceof DryRun) return err.result;
    if (isUniqueViolation(err)) {
      throw new ApiError("conflict", `Guide ${input.slug} was changed at the same time. Read it again and reapply your changes.`);
    }
    throw err;
  }
}

async function upload(db: Db, input: UploadGuideInput): Promise<UploadGuideResult> {
  const [app] = await db
    .select()
    .from(apps)
    .where(and(eq(apps.id, input.appId), eq(apps.teamId, input.teamId)));
  if (!app) throw new ApiError("not_found", "App not found.");

  if (input.areaId) {
    const [area] = await db
      .select()
      .from(areas)
      .where(and(eq(areas.id, input.areaId), eq(areas.appId, app.id)));
    if (!area) throw new ApiError("invalid", "Area does not belong to this app.");
  }

  const activeEnvironments = await db
    .select({ key: environments.key })
    .from(environments)
    .where(eq(environments.archived, false));
  const validation = validateGuide(input.content, {
    environments: activeEnvironments.map((e) => e.key),
  });
  if (!validation.ok) {
    throw new ApiError("invalid", "Guide content is invalid.", validation.errors);
  }
  const content = validation.content;

  const [existing] = await db
    .select()
    .from(guides)
    .where(and(eq(guides.appId, app.id), eq(guides.slug, input.slug)))
    .for("update");

  let diff: ScenarioDiff;
  if (existing) {
    if (input.baseVersion === undefined) {
      throw new ApiError(
        "conflict",
        `Guide ${input.slug} already exists at version ${existing.currentVersion}; pass baseVersion: ${existing.currentVersion} to add a version.`,
        { currentVersion: existing.currentVersion },
      );
    }
    if (input.baseVersion !== existing.currentVersion) {
      throw new ApiError(
        "conflict",
        `Guide ${input.slug} is at version ${existing.currentVersion}, not ${input.baseVersion}. Read it again and reapply your changes.`,
        { currentVersion: existing.currentVersion },
      );
    }
    if (!input.changeNote?.trim()) {
      throw new ApiError("invalid", "changeNote is required when adding a version.");
    }

    const [previous] = await db
      .select({ content: guideVersions.content })
      .from(guideVersions)
      .where(
        and(eq(guideVersions.guideId, existing.id), eq(guideVersions.version, existing.currentVersion)),
      );
    diff = diffScenarios(previous?.content ?? null, content);

    if (diff.removed.length) {
      const tested = await db
        .selectDistinct({ key: results.scenarioKey })
        .from(results)
        .innerJoin(runs, eq(runs.id, results.runId))
        .innerJoin(guideVersions, eq(guideVersions.id, runs.guideVersionId))
        .where(and(eq(guideVersions.guideId, existing.id), inArray(results.scenarioKey, diff.removed)));
      if (tested.length) {
        const keys = tested.map((t) => t.key);
        throw new ApiError(
          "invalid",
          `Scenario keys removed but have results: ${keys.join(", ")}. Keep them or mark them deprecated.`,
          { keys },
        );
      }
    }
  } else {
    if (input.baseVersion !== undefined) {
      throw new ApiError(
        "not_found",
        `Guide ${input.slug} does not exist, so there is no version ${input.baseVersion} to update. Check the slug, or omit baseVersion to create it.`,
      );
    }
    diff = diffScenarios(null, content);
  }

  const version = existing ? existing.currentVersion + 1 : 1;
  if (input.dryRun) throw new DryRun({ guideId: existing?.id ?? null, version, dryRun: true, diff });

  const author =
    "userId" in input.author
      ? { createdByUserId: input.author.userId }
      : { createdByTokenId: input.author.tokenId };
  const fields = {
    title: content.title,
    build: content.build ?? null,
    branch: content.branch ?? null,
    pr: content.pr ?? null,
    environments: content.environments,
    currentVersion: version,
  };

  let guideId: string;
  if (existing) {
    guideId = existing.id;
    await db
      .update(guides)
      .set({
        ...fields,
        ...(input.areaId !== undefined ? { areaId: input.areaId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(guides.id, guideId));
  } else {
    const [created] = await db
      .insert(guides)
      .values({ ...fields, appId: app.id, areaId: input.areaId ?? null, slug: input.slug })
      .returning({ id: guides.id });
    guideId = created!.id;
  }
  await db.insert(guideVersions).values({
    guideId,
    version,
    content,
    changeNote: input.changeNote ?? null,
    ...author,
  });

  return { guideId, version, dryRun: false, diff };
}
