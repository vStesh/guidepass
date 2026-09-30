// Types and pure helpers, safe to import in the browser (no validator).

/**
 * A platform key. Every app picks its platforms: the built-in ones below and
 * its own (e.g. `admin`), each a lowercase kebab-case key.
 */
export type Platform = string;

/** Built-in platforms; `api` covers backend changes checked with an HTTP client, logs or the database. */
export const builtInPlatforms = ["ios", "android", "web", "api"] as const;

/** What a guide covers, shown as a badge and used for filtering. */
export type GuideType = "feature" | "bugfix" | "improvement" | "mixed";
export const guideTypes: GuideType[] = ["feature", "bugfix", "improvement", "mixed"];

export interface Scenario {
  key: string;
  title: string;
  important?: boolean;
  platforms?: Platform[];
  environments?: string[];
  steps: string[];
  expected: string;
  deprecated?: { reason: string } | null;
}

export interface GuideContent {
  schemaVersion: 1;
  title: string;
  type?: GuideType;
  build?: string;
  branch?: string;
  pr?: string;
  meta?: string;
  environments: string[];
  context?: string;
  changelog?: { section: string; items: string[] }[];
  prerequisites?: string[];
  scenarios: Scenario[];
  related?: { label: string; url?: string | null }[];
}

export interface ScenarioDiff {
  added: string[];
  changed: string[];
  deprecated: string[];
  removed: string[];
  unchanged: string[];
}

/** A scenario is unchanged when everything a tester relies on is the same. */
export function sameCheck(a: Scenario, b: Scenario): boolean {
  const pick = (s: Scenario) =>
    JSON.stringify([s.steps, s.expected, s.platforms ?? null, s.environments ?? null]);
  return pick(a) === pick(b);
}

/**
 * Compares scenarios of two guide versions by key. `added` and `changed` are the
 * active scenarios that need testing again; `deprecated` are those nobody tests
 * in the new version; `removed` are gone.
 */
export function diffScenarios(previous: GuideContent | null, next: GuideContent): ScenarioDiff {
  const diff: ScenarioDiff = { added: [], changed: [], deprecated: [], removed: [], unchanged: [] };
  const before = new Map((previous?.scenarios ?? []).map((s) => [s.key, s]));

  for (const scenario of next.scenarios) {
    const old = before.get(scenario.key);
    before.delete(scenario.key);
    if (!old) diff.added.push(scenario.key);
    // Deprecated in the new version, whether newly or still: nobody tests it.
    else if (scenario.deprecated) diff.deprecated.push(scenario.key);
    // Brought back from deprecation: results from before don't count, so it's tested again.
    else if (old.deprecated || !sameCheck(old, scenario)) diff.changed.push(scenario.key);
    else diff.unchanged.push(scenario.key);
  }
  diff.removed.push(...before.keys());
  return diff;
}

/** Whether a scenario has to be checked in this environment on this platform. */
export function appliesTo(scenario: Scenario, environment: string, platform: Platform): boolean {
  return (
    !scenario.deprecated &&
    (!scenario.platforms || scenario.platforms.includes(platform)) &&
    (!scenario.environments || scenario.environments.includes(environment))
  );
}

export type ResultStatus = "pass" | "fail" | "skip";
export type Verdict = ResultStatus | "conflict" | "untested";

/**
 * Combines everyone's results for one scenario in one environment on one platform.
 * A pass next to a fail is a conflict: it works for some people or devices and not others.
 */
export function verdict(statuses: ResultStatus[]): Verdict {
  const has = (s: ResultStatus) => statuses.includes(s);
  if (has("fail")) return has("pass") ? "conflict" : "fail";
  if (has("pass")) return "pass";
  if (has("skip")) return "skip";
  return "untested";
}
