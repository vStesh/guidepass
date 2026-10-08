import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The updater's buildspec only runs inside CodeBuild in someone's AWS account,
// so a mistake there shows up only when an owner presses Update. Catch it here.
const buildspec = parse(readFileSync(new URL("../../infra/updater/buildspec.yml", import.meta.url), "utf8")) as {
  version: number;
  phases: Record<string, { commands: unknown[] }>;
};

describe("updater buildspec", () => {
  it("is valid YAML whose commands are all plain strings", () => {
    expect(buildspec.version).toBe(0.2);
    expect(Object.keys(buildspec.phases)).toEqual(["install", "pre_build", "build"]);
    for (const [phase, { commands }] of Object.entries(buildspec.phases)) {
      for (const command of commands) {
        // A command with an unquoted ": " parses as a mapping, not a string.
        expect(typeof command, `${phase}: ${JSON.stringify(command)}`).toBe("string");
      }
    }
  });

  it("is valid bash, run as one script like CodeBuild does", () => {
    const script = Object.values(buildspec.phases)
      .flatMap((p) => p.commands as string[])
      .join("\n");
    expect(() => execFileSync("bash", ["-n"], { input: script })).not.toThrow();
  });
});
