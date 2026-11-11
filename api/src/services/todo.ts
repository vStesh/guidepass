import { and, desc, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { apps, guideVersions, guides, results, runs } from "../db/schema.ts";
import { countRun } from "./results.ts";

/** Guides of the team's active apps that are still active, at their current version. */
const activeGuide = (teamId: string) =>
  and(eq(apps.teamId, teamId), eq(apps.archived, false), eq(guides.status, "active"));

/**
 * What a person has to test: their unfinished runs, and the active guides whose
 * current version they haven't started yet, newest first. `testers` is how many
 * people have runs on that version so far (0: nobody has looked at it).
 */
export async function myTodo(db: Db, teamId: string, userId: string) {
  const open = await db
    .select({
      id: runs.id,
      environment: runs.environmentKey,
      platform: runs.platform,
      device: runs.device,
      build: runs.build,
      startedAt: runs.startedAt,
      guideId: guides.id,
      title: guides.title,
      appName: apps.name,
      version: guideVersions.version,
      currentVersion: guides.currentVersion,
      content: guideVersions.content,
    })
    .from(runs)
    .innerJoin(guideVersions, eq(guideVersions.id, runs.guideVersionId))
    .innerJoin(guides, eq(guides.id, guideVersions.guideId))
    .innerJoin(apps, eq(apps.id, guides.appId))
    .where(and(eq(runs.testerId, userId), isNull(runs.finishedAt), activeGuide(teamId)))
    .orderBy(desc(runs.startedAt))
    .limit(20);
  const rows = open.length
    ? await db
        .select({ runId: results.runId, scenarioKey: results.scenarioKey, status: results.status })
        .from(results)
        .where(inArray(results.runId, open.map((r) => r.id)))
    : [];

  const waiting = await db
    .select({
      id: guides.id,
      title: guides.title,
      type: guides.type,
      build: guides.build,
      environments: guides.environments,
      appId: apps.id,
      appName: apps.name,
      currentVersion: guides.currentVersion,
      updatedAt: guides.updatedAt,
      testers: sql<number>`(select count(distinct ${runs.testerId}) from ${runs} where ${runs.guideVersionId} = ${guideVersions.id})`,
    })
    .from(guides)
    .innerJoin(apps, eq(apps.id, guides.appId))
    .innerJoin(guideVersions, and(eq(guideVersions.guideId, guides.id), eq(guideVersions.version, guides.currentVersion)))
    .where(
      and(
        activeGuide(teamId),
        notExists(
          db
            .select({ id: runs.id })
            .from(runs)
            .where(and(eq(runs.guideVersionId, guideVersions.id), eq(runs.testerId, userId))),
        ),
      ),
    )
    .orderBy(desc(guides.updatedAt))
    .limit(30);

  return {
    runs: open.map(({ content, ...run }) => ({
      ...run,
      counts: countRun(content, run.environment, run.platform, rows.filter((r) => r.runId === run.id)),
    })),
    waiting: waiting.map((g) => ({ ...g, testers: Number(g.testers) })),
  };
}

/** Active guides of an app whose current version nobody has started testing, oldest first. */
export async function untestedGuides(db: Db, appId: string) {
  return db
    .select({ id: guides.id, title: guides.title, build: guides.build, updatedAt: guides.updatedAt })
    .from(guides)
    .innerJoin(guideVersions, and(eq(guideVersions.guideId, guides.id), eq(guideVersions.version, guides.currentVersion)))
    .where(
      and(
        eq(guides.appId, appId),
        eq(guides.status, "active"),
        notExists(db.select({ id: runs.id }).from(runs).where(eq(runs.guideVersionId, guideVersions.id))),
      ),
    )
    .orderBy(guides.updatedAt);
}
