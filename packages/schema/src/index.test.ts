import { describe, expect, it } from "vitest";
import example from "../examples/build-179.json" with { type: "json" };
import { appliesTo, diffScenarios, looksLikeSecret, needsEvidence, validateGuide, verdict, type GuideContent } from "./index.ts";

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

describe("platforms and type", () => {
  it("accepts custom platform keys the app has, and rejects others", () => {
    const content = structuredClone(example) as GuideContent;
    content.scenarios[1]!.platforms = ["admin"];
    expect(validateGuide(content, { environments, platforms: ["ios", "android", "admin"] }).ok).toBe(true);
    const result = validateGuide(content, { environments, platforms: ["ios", "android"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.path).toBe("/scenarios/1/platforms/0");
  });

  it("checks the guide type", () => {
    expect(validateGuide({ ...example, type: "bugfix" }, { environments }).ok).toBe(true);
    expect(validateGuide({ ...example, type: "hotfix" }, { environments }).ok).toBe(false);
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
      deprecated: ["android-keyboard", "pull-to-retry"],
      removed: ["old-backend-flat-list"],
      unchanged: [],
    });
  });

  it("treats a scenario brought back from deprecation as changed", () => {
    const previous = structuredClone(example) as GuideContent;
    const next = structuredClone(example) as GuideContent;
    delete next.scenarios[2]!.deprecated;
    expect(diffScenarios(previous, next).changed).toContain("pull-to-retry");
  });

  it("treats every scenario as added for a new guide", () => {
    expect(diffScenarios(null, example as GuideContent).added).toHaveLength(4);
  });
});

describe("verdict", () => {
  it.each([
    [["pass", "fail"], "conflict"],
    [["fail", "skip"], "fail"],
    [["pass", "skip"], "pass"],
    [["pass", "blocked"], "pass"],
    [["blocked", "skip"], "blocked"],
    [["skip"], "skip"],
    [[], "untested"],
  ] as const)("%j → %s", (statuses, expected) => {
    expect(verdict([...statuses])).toBe(expected);
  });
});

describe("appliesTo", () => {
  const [reply, android, deprecated, stgOnly] = (example as GuideContent).scenarios;
  it("respects platforms, environments and deprecation", () => {
    expect(appliesTo(reply!, "dev", "ios")).toBe(true);
    expect(appliesTo(android!, "dev", "ios")).toBe(false);
    expect(appliesTo(deprecated!, "dev", "ios")).toBe(false);
    expect(appliesTo(stgOnly!, "dev", "ios")).toBe(false);
    expect(appliesTo(stgOnly!, "stg", "android")).toBe(true);
  });
});

describe("proof", () => {
  it("makes requiring proof a change, so passes without proof are checked again", () => {
    const next = structuredClone(example) as GuideContent;
    next.scenarios[0] = { ...next.scenarios[0]!, evidence: true };
    expect(diffScenarios(example as GuideContent, next).changed).toEqual([next.scenarios[0]!.key]);
  });

  const scenario = (example as GuideContent).scenarios[0]!;

  it("is needed for every fail and for passes on evidence scenarios", () => {
    expect(needsEvidence(scenario, "fail")).toBe(true);
    expect(needsEvidence(scenario, "pass")).toBe(false);
    expect(needsEvidence({ ...scenario, evidence: true }, "pass")).toBe(true);
    expect(needsEvidence({ ...scenario, evidence: true }, "blocked")).toBe(false);
  });

  it("refuses what looks like a secret, not ordinary request logs", () => {
    expect(looksLikeSecret("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123")).toBe(true);
    expect(looksLikeSecret("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig")).toBe(true);
    expect(looksLikeSecret("gp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")).toBe(true);
    expect(looksLikeSecret("AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(looksLikeSecret("ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(true);
    expect(looksLikeSecret('{"access_token": "abcdefghijklmnop123"}')).toBe(true);
    expect(looksLikeSecret("https://bucket.s3.amazonaws.com/a.png?X-Amz-Signature=abcdef0123456789abcdef")).toBe(true);
    expect(looksLikeSecret("GET /reports/42 → 403 {\"error\":\"forbidden\"}, Authorization: Bearer <redacted>")).toBe(false);
    expect(looksLikeSecret("svt_lambda_gp_reports_filtering_development_v2")).toBe(false);
  });

  it("accepts evidence and automated in guides", () => {
    const content = structuredClone(example) as GuideContent;
    content.scenarios[0] = { ...content.scenarios[0]!, evidence: true, automated: "ci: e2e/replies.spec.ts" };
    expect(validateGuide(content, { environments: ["dev", "stg"] }).ok).toBe(true);
  });
});

