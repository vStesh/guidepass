import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import guideSchema from "../guide.schema.json" with { type: "json" };
import type { GuideContent } from "./core.ts";

export * from "./core.ts";
export { guideSchema };

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

