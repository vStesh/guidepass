import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";
import { ApiError } from "./errors.ts";

/** zValidator that reports failures in the API's error format. */
export const validate = <T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new ApiError(
        "invalid",
        "Request is invalid.",
        result.error.issues.map((i) => ({ path: `/${i.path.join("/")}`, message: i.message })),
      );
    }
  });
