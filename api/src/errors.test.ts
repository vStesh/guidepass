import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "./errors.ts";

describe("isUniqueViolation", () => {
  it("recognizes PGlite errors by code", () => {
    expect(isUniqueViolation({ message: "Failed query", cause: { code: "23505" } })).toBe(true);
  });

  it("recognizes Data API errors by message", () => {
    const cause = { name: "BadRequestException", message: 'ERROR: duplicate key value violates unique constraint "apps_team_id_slug_unique"' };
    expect(isUniqueViolation({ message: "Failed query: insert ...", cause })).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isUniqueViolation(new Error("timeout"))).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
