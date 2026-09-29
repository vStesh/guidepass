// Types and pure helpers, safe to import in the browser (no validator).

export type Platform = "ios" | "android" | "web";

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

/** Compares scenarios of two guide versions by key. */
export function diffScenarios(previous: GuideContent | null, next: GuideContent): ScenarioDiff {
  const diff: ScenarioDiff = { added: [], changed: [], deprecated: [], removed: [], unchanged: [] };
  const before = new Map((previous?.scenarios ?? []).map((s) => [s.key, s]));

  for (const scenario of next.scenarios) {
    const old = before.get(scenario.key);
    before.delete(scenario.key);
    if (!old) diff.added.push(scenario.key);
    else if (scenario.deprecated && !old.deprecated) diff.deprecated.push(scenario.key);
    else if (sameCheck(old, scenario)) diff.unchanged.push(scenario.key);
    else diff.changed.push(scenario.key);
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
