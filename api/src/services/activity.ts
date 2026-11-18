import { eq, inArray } from "drizzle-orm";
import { appliesTo, sameCheck, verdict, type GuideContent, type Platform, type ResultStatus, type Verdict } from "@guidepass/schema";
import type { Db } from "../db/client.ts";
import { apps, guideVersions, results, runs } from "../db/schema.ts";

/** How far testing of a guide's current version has got, for the guide lists. */
export interface GuideActivity {
  /** Scenario × environment × platform cells by combined verdict, as on the guide's page. */
  counts: Record<Verdict, number>;
  /** People with results that count for the current version, or runs on it. */
  testers: number;
  /** Runs on the current version, and how many of them are not finished. */
  runs: number;
  openRuns: number;
  /** Newest run start, finish or result on any version of the guide. */
  lastActivityAt: Date | null;
  /** The person's own runs on the current version. */
  mine: "none" | "open" | "finished";
  /** Some counted results were recorded on an older version where the scenario was the same. */
  carriedOver: boolean;
}

interface ListedGuide {
  id: string;
  appId: string;
  currentVersion: number;
}

/** Versions are loaded a few at a time, to keep Data API responses small. */
const CHUNK = 8;

/**
 * The testing state of each listed guide: the same combined verdicts as the guide's
 * page (results on older versions count while the scenario hasn't changed), plus who
 * is testing and when anything last happened.
 */
export async function guideActivity(db: Db, list: ListedGuide[], userId: string): Promise<Map<string, GuideActivity>> {
  const activity = new Map<string, GuideActivity>();
  if (!list.length) return activity;
  const ids = list.map((g) => g.id);

  const runRows = await db
    .select({
      id: runs.id,
      guideId: guideVersions.guideId,
      version: guideVersions.version,
      testerId: runs.testerId,
      environment: runs.environmentKey,
      platform: runs.platform,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
    })
    .from(runs)
    .innerJoin(guideVersions, eq(guideVersions.id, runs.guideVersionId))
    .where(inArray(guideVersions.guideId, ids));
  const resultRows = runRows.length
    ? await db
        .select({ runId: results.runId, scenarioKey: results.scenarioKey, status: results.status, updatedAt: results.updatedAt })
        .from(results)
        .innerJoin(runs, eq(runs.id, results.runId))
        .innerJoin(guideVersions, eq(guideVersions.id, runs.guideVersionId))
        .where(inArray(guideVersions.guideId, ids))
    : [];

  // Each guide needs its versions from the oldest one with runs up to the current one.
  const oldest = new Map(list.map((g) => [g.id, g.currentVersion]));
  for (const run of runRows) oldest.set(run.guideId, Math.min(oldest.get(run.guideId)!, run.version));
  const versionRows = await db
    .select({ id: guideVersions.id, guideId: guideVersions.guideId, version: guideVersions.version })
    .from(guideVersions)
    .where(inArray(guideVersions.guideId, ids));
  const wanted = versionRows.filter((v) => {
    const guide = list.find((g) => g.id === v.guideId)!;
    return v.version >= oldest.get(v.guideId)! && v.version <= guide.currentVersion;
  });
  const contents = new Map<string, GuideContent>();
  for (let i = 0; i < wanted.length; i += CHUNK) {
    const chunk = wanted.slice(i, i + CHUNK);
    const rows = await db
      .select({ guideId: guideVersions.guideId, version: guideVersions.version, content: guideVersions.content })
      .from(guideVersions)
      .where(inArray(guideVersions.id, chunk.map((v) => v.id)));
    for (const row of rows) contents.set(`${row.guideId}/${row.version}`, row.content);
  }

  const appIds = [...new Set(list.map((g) => g.appId))];
  const appRows = await db.select({ id: apps.id, platforms: apps.platforms }).from(apps).where(inArray(apps.id, appIds));
  const platformsOf = new Map(appRows.map((a) => [a.id, a.platforms]));

  const resultsByRun = new Map<string, { scenarioKey: string; status: ResultStatus; updatedAt: Date }[]>();
  for (const r of resultRows) {
    const rows = resultsByRun.get(r.runId) ?? [];
    rows.push(r);
    resultsByRun.set(r.runId, rows);
  }

  for (const guide of list) {
    const content = contents.get(`${guide.id}/${guide.currentVersion}`);
    if (!content) continue;
    const guideRuns = runRows.filter((r) => r.guideId === guide.id);

    // For each scenario, the versions whose results still apply (see getGuideResults).
    const valid = new Map(content.scenarios.map((s) => [s.key, new Set([guide.currentVersion])]));
    let open = new Set(content.scenarios.map((s) => s.key));
    for (let version = guide.currentVersion - 1; version >= oldest.get(guide.id)! && open.size; version--) {
      const older = contents.get(`${guide.id}/${version}`);
      if (!older) break;
      const stillOpen = new Set<string>();
      for (const key of open) {
        const current = content.scenarios.find((s) => s.key === key)!;
        const previous = older.scenarios.find((s) => s.key === key);
        if (!previous || previous.deprecated || !sameCheck(previous, current)) continue;
        valid.get(key)!.add(version);
        stillOpen.add(key);
      }
      open = stillOpen;
    }

    const counts: Record<Verdict, number> = { pass: 0, fail: 0, conflict: 0, blocked: 0, skip: 0, untested: 0 };
    const testers = new Set<string>();
    let carriedOver = false;
    for (const environment of content.environments) {
      for (const platform of platformsOf.get(guide.appId) ?? ([] as Platform[])) {
        for (const scenario of content.scenarios) {
          if (!appliesTo(scenario, environment, platform)) continue;
          const statuses: ResultStatus[] = [];
          for (const run of guideRuns) {
            if (run.environment !== environment || run.platform !== platform) continue;
            if (!valid.get(scenario.key)!.has(run.version)) continue;
            const result = resultsByRun.get(run.id)?.find((r) => r.scenarioKey === scenario.key);
            if (!result) continue;
            statuses.push(result.status);
            testers.add(run.testerId);
            if (run.version !== guide.currentVersion) carriedOver = true;
          }
          counts[verdict(statuses)]++;
        }
      }
    }

    const current = guideRuns.filter((r) => r.version === guide.currentVersion);
    for (const run of current) testers.add(run.testerId);
    const times = guideRuns.flatMap((r) => [
      r.startedAt,
      ...(r.finishedAt ? [r.finishedAt] : []),
      ...(resultsByRun.get(r.id) ?? []).map((x) => x.updatedAt),
    ]);
    const mineRuns = current.filter((r) => r.testerId === userId);
    activity.set(guide.id, {
      counts,
      testers: testers.size,
      runs: current.length,
      openRuns: current.filter((r) => !r.finishedAt).length,
      lastActivityAt: times.length ? new Date(Math.max(...times.map((t) => new Date(t).getTime()))) : null,
      mine: mineRuns.some((r) => !r.finishedAt) ? "open" : mineRuns.length ? "finished" : "none",
      carriedOver,
    });
  }
  return activity;
}

/** Adds `activity` to each guide of a list. */
export async function withActivity<G extends ListedGuide>(db: Db, list: G[], userId: string) {
  const activity = await guideActivity(db, list, userId);
  return list.map((g) => ({ ...g, activity: activity.get(g.id) ?? null }));
}

