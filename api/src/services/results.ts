import { and, asc, eq, gte, lte } from "drizzle-orm";
import {
  appliesTo,
  sameCheck,
  verdict,
  type GuideContent,
  type Platform,
  type ResultStatus,
  type Verdict,
} from "@guidepass/schema";
import type { Db } from "../db/client.ts";
import { apps, guideVersions, guides, results, runs, users } from "../db/schema.ts";
import { ApiError } from "../errors.ts";

export type GuideRow = typeof guides.$inferSelect;
export type AppRow = typeof apps.$inferSelect;

/** A guide the caller's team can see, with its app; 404 otherwise. */
export async function loadGuide(db: Db, teamId: string, guideId: string): Promise<{ guide: GuideRow; app: AppRow }> {
  const [row] = await db
    .select({ guide: guides, app: apps })
    .from(guides)
    .innerJoin(apps, eq(apps.id, guides.appId))
    .where(and(eq(guides.id, guideId), eq(apps.teamId, teamId)));
  if (!row) throw new ApiError("not_found", "Guide not found.");
  return row;
}

export interface Counts {
  pass: number;
  fail: number;
  blocked: number;
  skip: number;
  untested: number;
}

export interface RunSummary {
  id: string;
  version: number;
  tester: { id: string; name: string | null; email: string };
  environment: string;
  platform: Platform;
  device: string;
  build: string | null;
  commit: string | null;
  account: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  counts: Counts;
}

export interface ScenarioResult {
  runId: string;
  tester: { id: string; name: string | null };
  device: string;
  build: string | null;
  commit: string | null;
  account: string | null;
  status: ResultStatus;
  note: string | null;
  evidence: string | null;
  issueUrl: string | null;
  updatedAt: Date;
  /** Set when the result was recorded on an older version where this scenario was the same. */
  fromVersion: number | null;
}

export interface Cell {
  environment: string;
  platform: Platform;
  verdict: Verdict;
  results: ScenarioResult[];
}

export interface ScenarioResults {
  key: string;
  title: string;
  important: boolean;
  /** A pass needs proof here. */
  evidence: boolean;
  /** Automated test that also covers it; not a person's result. */
  automated: string | null;
  cells: Cell[];
}

export interface ResultsFilter {
  version?: number;
  environment?: string;
  platform?: Platform;
  testerId?: string;
  filter?: "problems" | "all";
}

export interface GuideResults {
  guideId: string;
  version: number;
  runs: RunSummary[];
  scenarios: ScenarioResults[];
  /** Scenario counts by verdict, per environment and platform. */
  progress: { environment: string; platform: Platform; counts: Record<Verdict, number> }[];
}

/**
 * Everyone's results for one version of a guide, combined per environment and
 * platform. Results recorded on older versions count when the scenario has not
 * changed since then.
 */
export async function getGuideResults(
  db: Db,
  guide: GuideRow,
  app: AppRow,
  options: ResultsFilter = {},
): Promise<GuideResults> {
  const versionNumber = options.version ?? guide.currentVersion;
  const versions = await db
    .select({ id: guideVersions.id, version: guideVersions.version })
    .from(guideVersions)
    .where(eq(guideVersions.guideId, guide.id))
    .orderBy(asc(guideVersions.version));
  const targetIndex = versions.findIndex((v) => v.version === versionNumber);
  if (targetIndex < 0) throw new ApiError("not_found", `Version ${versionNumber} not found.`);
  const content = await loadContent(db, versions[targetIndex]!.id);

  if (options.environment && !content.environments.includes(options.environment)) {
    throw new ApiError("invalid", `Version ${versionNumber} is not run on ${options.environment}.`, {
      environments: content.environments,
    });
  }
  if (options.platform && !app.platforms.includes(options.platform)) {
    throw new ApiError("invalid", `This app has no ${options.platform} build.`, { platforms: app.platforms });
  }

  // For each scenario, the versions whose results still apply: this one and the
  // unbroken run of earlier versions where the scenario was the same. Older
  // versions are loaded one at a time and only while some scenario still matches,
  // to keep Data API responses small.
  const validVersions = new Map(content.scenarios.map((s) => [s.key, new Set([versionNumber])]));
  let open = new Set(content.scenarios.map((s) => s.key));
  for (let i = targetIndex - 1; i >= 0 && open.size; i--) {
    const older = await loadContent(db, versions[i]!.id);
    const stillOpen = new Set<string>();
    for (const key of open) {
      const current = content.scenarios.find((s) => s.key === key)!;
      const previous = older.scenarios.find((s) => s.key === key);
      if (!previous || previous.deprecated || !sameCheck(previous, current)) continue;
      validVersions.get(key)!.add(versions[i]!.version);
      stillOpen.add(key);
    }
    open = stillOpen;
  }
  const oldestNeeded = Math.min(...[...validVersions.values()].flatMap((set) => [...set]), versionNumber);

  const runFilters = [
    eq(guideVersions.guideId, guide.id),
    gte(guideVersions.version, oldestNeeded),
    lte(guideVersions.version, versionNumber),
  ];
  if (options.environment) runFilters.push(eq(runs.environmentKey, options.environment));
  if (options.platform) runFilters.push(eq(runs.platform, options.platform));
  if (options.testerId) runFilters.push(eq(runs.testerId, options.testerId));

  const runRows = await db
    .select({
      run: runs,
      version: guideVersions.version,
      tester: { id: users.id, name: users.name, email: users.email },
    })
    .from(runs)
    .innerJoin(guideVersions, eq(guideVersions.id, runs.guideVersionId))
    .innerJoin(users, eq(users.id, runs.testerId))
    .where(and(...runFilters))
    .orderBy(asc(runs.startedAt));

  // Joined instead of `IN (run ids)` so the request stays small however many runs there are.
  const resultRows = await db
    .select({ result: results })
    .from(results)
    .innerJoin(runs, eq(runs.id, results.runId))
    .innerJoin(guideVersions, eq(guideVersions.id, runs.guideVersionId))
    .where(and(...runFilters));
  const resultsByRun = new Map<string, (typeof results.$inferSelect)[]>();
  for (const { result } of resultRows) {
    const list = resultsByRun.get(result.runId) ?? [];
    list.push(result);
    resultsByRun.set(result.runId, list);
  }

  const environments = options.environment ? [options.environment] : content.environments;
  const platforms = options.platform ? [options.platform] : app.platforms;

  const scenarios: ScenarioResults[] = content.scenarios.map((scenario) => {
    const cells: Cell[] = [];
    for (const environment of environments) {
      for (const platform of platforms) {
        if (!appliesTo(scenario, environment, platform)) continue;
        const cellResults: ScenarioResult[] = [];
        for (const { run, version: runVersion, tester } of runRows) {
          if (run.environmentKey !== environment || run.platform !== platform) continue;
          if (!validVersions.get(scenario.key)!.has(runVersion)) continue;
          const result = resultsByRun.get(run.id)?.find((r) => r.scenarioKey === scenario.key);
          if (!result) continue;
          cellResults.push({
            runId: run.id,
            tester: { id: tester.id, name: tester.name ?? tester.email },
            device: run.device,
            build: run.build,
            commit: run.commit,
            account: run.account,
            status: result.status,
            note: result.note,
            evidence: result.evidence,
            issueUrl: result.issueUrl,
            updatedAt: result.updatedAt,
            fromVersion: runVersion === versionNumber ? null : runVersion,
          });
        }
        cells.push({
          environment,
          platform,
          verdict: verdict(cellResults.map((r) => r.status)),
          results: cellResults,
        });
      }
    }
    return {
      key: scenario.key,
      title: scenario.title,
      important: !!scenario.important,
      evidence: !!scenario.evidence,
      automated: scenario.automated ?? null,
      cells,
    };
  });

  const progress = environments.flatMap((environment) =>
    platforms.map((platform) => {
      const counts: Record<Verdict, number> = { pass: 0, fail: 0, conflict: 0, blocked: 0, skip: 0, untested: 0 };
      for (const s of scenarios) {
        const cell = s.cells.find((c) => c.environment === environment && c.platform === platform);
        if (cell) counts[cell.verdict]++;
      }
      return { environment, platform, counts };
    }),
  );

  // Runs on this version only; carried-over results name their tester and device inline.
  const runSummaries: RunSummary[] = runRows
    .filter(({ version }) => version === versionNumber)
    .map(({ run, tester }) => ({
      id: run.id,
      version: versionNumber,
      tester,
      environment: run.environmentKey,
      platform: run.platform,
      device: run.device,
      build: run.build,
      commit: run.commit,
      account: run.account,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      counts: countRun(content, run.environmentKey, run.platform, resultsByRun.get(run.id) ?? []),
    }));

  const isProblem = (s: ScenarioResults) =>
    s.cells.some(
      (c) =>
        c.verdict === "fail" ||
        c.verdict === "conflict" ||
        c.verdict === "blocked" ||
        c.verdict === "skip" ||
        (s.important && c.verdict === "untested"),
    );

  return {
    guideId: guide.id,
    version: versionNumber,
    runs: runSummaries,
    scenarios: (options.filter ?? "problems") === "all" ? scenarios : scenarios.filter(isProblem),
    progress,
  };
}

async function loadContent(db: Db, versionId: string): Promise<GuideContent> {
  const [row] = await db
    .select({ content: guideVersions.content })
    .from(guideVersions)
    .where(eq(guideVersions.id, versionId));
  return row!.content;
}

/** One run's own progress over the scenarios that apply to it. */
export function countRun(
  content: GuideContent,
  environment: string,
  platform: Platform,
  rows: { scenarioKey: string; status: ResultStatus }[],
): Counts {
  const counts: Counts = { pass: 0, fail: 0, blocked: 0, skip: 0, untested: 0 };
  for (const scenario of content.scenarios) {
    if (!appliesTo(scenario, environment, platform)) continue;
    const status = rows.find((r) => r.scenarioKey === scenario.key)?.status;
    counts[status ?? "untested"]++;
  }
  return counts;
}
