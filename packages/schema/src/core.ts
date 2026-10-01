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
  /** A pass needs proof (auth, privacy, security checks); a fail always does. */
  evidence?: boolean;
  /** Also covered by an automated test (CI job or test name). Shown apart: it doesn't replace a person's pass. */
  automated?: string;
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

/**
 * A scenario is unchanged when everything a tester relies on is the same.
 * Starting to require proof changes it too, so passes without proof aren't carried over.
 */
export function sameCheck(a: Scenario, b: Scenario): boolean {
  const pick = (s: Scenario) =>
    JSON.stringify([s.steps, s.expected, s.platforms ?? null, s.environments ?? null, !!s.evidence]);
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

/** `blocked`: couldn't be checked because of something outside the scenario (environment down, no test data). */
export type ResultStatus = "pass" | "fail" | "blocked" | "skip";
export type Verdict = ResultStatus | "conflict" | "untested";

/**
 * Combines everyone's results for one scenario in one environment on one platform.
 * A pass next to a fail is a conflict: it works for some people or devices and not others.
 * One person's pass outweighs another's blocked or skipped.
 */
export function verdict(statuses: ResultStatus[]): Verdict {
  const has = (s: ResultStatus) => statuses.includes(s);
  if (has("fail")) return has("pass") ? "conflict" : "fail";
  if (has("pass")) return "pass";
  if (has("blocked")) return "blocked";
  if (has("skip")) return "skip";
  return "untested";
}

/** Whether a result needs proof: every fail, and a pass on a scenario marked `evidence`. */
export function needsEvidence(scenario: Scenario, status: ResultStatus): boolean {
  return status === "fail" || (status === "pass" && !!scenario.evidence);
}

/**
 * Finds what looks like a secret in text testers paste as proof: bearer tokens,
 * JWTs, Guidepass and AWS keys. Proof is shared with the team; secrets must be cut out.
 */
export function looksLikeSecret(text: string): boolean {
  return [
    /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{20,}/i,
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
    /\bgp_[A-Za-z0-9_-]{20,}/,
    /\b(AKIA|ASIA)[0-9A-Z]{16}\b/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
    /\b[sr]k_live_[A-Za-z0-9]{16,}/,
    /\bAIza[0-9A-Za-z_-]{35}\b/,
    /["']?(access_token|refresh_token|id_token|api[_-]?key|x-api-key|password|secret)["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/i,
    /[?&](token|access_token|X-Amz-Signature|sig)=[A-Za-z0-9._~%+/=-]{12,}/i,
  ].some((re) => re.test(text));
}
