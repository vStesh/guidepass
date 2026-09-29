import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import guideSchema from "../guide.schema.json" with { type: "json" };

export { guideSchema };

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

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; content: GuideContent }
  | { ok: false; errors: ValidationError[] };

const ajv = new Ajv2020({ allErrors: true });
addFormats.default(ajv);
const validateSchema = ajv.compile<GuideContent>(guideSchema);

/**
 * Validates guide content against the JSON Schema and the rules the schema
 * cannot express: unique scenario keys and known environment keys.
 */
export function validateGuide(
  content: unknown,
  options: { environments: string[] },
): ValidationResult {
  if (!validateSchema(content)) {
    return {
      ok: false,
      errors: (validateSchema.errors ?? []).map((e) => ({
        path: e.instancePath || "/",
        message: e.message ?? "is invalid",
      })),
    };
  }

  const errors: ValidationError[] = [];
  const known = new Set(options.environments);

  content.environments.forEach((env, i) => {
    if (!known.has(env)) {
      errors.push({ path: `/environments/${i}`, message: `unknown environment "${env}"` });
    }
  });

  const guideEnvironments = new Set(content.environments);
  const seen = new Set<string>();
  content.scenarios.forEach((scenario, i) => {
    if (seen.has(scenario.key)) {
      errors.push({ path: `/scenarios/${i}/key`, message: `duplicate key "${scenario.key}"` });
    }
    seen.add(scenario.key);
    scenario.environments?.forEach((env, j) => {
      if (!guideEnvironments.has(env)) {
        errors.push({
          path: `/scenarios/${i}/environments/${j}`,
          message: `"${env}" is not one of the guide's environments`,
        });
      }
    });
  });

  return errors.length ? { ok: false, errors } : { ok: true, content };
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
