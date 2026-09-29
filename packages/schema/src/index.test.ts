import { describe, expect, it } from "vitest";
import example from "../examples/build-179.json" with { type: "json" };
import { diffScenarios, validateGuide, type GuideContent } from "./index.ts";

const environments = ["dev", "stg", "prod"];

describe("validateGuide", () => {
  it("accepts the example guide", () => {
    expect(validateGuide(example, { environments }).ok).toBe(true);
  });

  it("reports schema errors with paths", () => {
    const result = validateGuide({ ...example, scenarios: [{ key: "Bad Key" }] }, { environments });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.path)).toContain("/scenarios/0/key");
  });

  it("rejects unknown environments and duplicate keys", () => {
    const content = structuredClone(example) as GuideContent;
    content.environments = ["dev", "qa"];
    content.scenarios.push({ ...content.scenarios[0]!, title: "Copy" });
    const result = validateGuide(content, { environments });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          { path: "/environments/1", message: 'unknown environment "qa"' },
          { path: "/scenarios/4/key", message: 'duplicate key "reply-to-comment"' },
        ]),
      );
    }
  });

  it("rejects scenario environments outside the guide's list", () => {
    const content = structuredClone(example) as GuideContent;
    content.environments = ["dev"];
    const result = validateGuide(content, { environments });
    expect(result.ok).toBe(false);
  });
});

describe("diffScenarios", () => {
  it("classifies scenarios by key", () => {
    const previous = structuredClone(example) as GuideContent;
    const next = structuredClone(example) as GuideContent;
    next.scenarios[0]!.expected = "Something else";
    next.scenarios[1]!.deprecated = { reason: "Moved" };
    next.scenarios.splice(3, 1);
    next.scenarios.push({ key: "new-check", title: "New", steps: ["Do"], expected: "Done" });

    expect(diffScenarios(previous, next)).toEqual({
      added: ["new-check"],
      changed: ["reply-to-comment"],
      deprecated: ["android-keyboard"],
      removed: ["old-backend-flat-list"],
      unchanged: ["pull-to-retry"],
    });
  });

  it("treats every scenario as added for a new guide", () => {
    expect(diffScenarios(null, example as GuideContent).added).toHaveLength(4);
  });
});
