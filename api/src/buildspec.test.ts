import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

  it("keeps only the newest snapshots taken before updates", () => {
    // A fake `aws` that lists snapshots and records deletions.
    const dir = mkdtempSync(join(tmpdir(), "prune-"));
    const deleted = join(dir, "deleted");
    writeFileSync(
      join(dir, "aws"),
      [
        "#!/usr/bin/env bash",
        'if [[ "$2" == describe-db-cluster-snapshots ]]; then',
        "  printf '%s\\t' gp-x-db-before-v0-1-0-20260101000000 gp-x-db-before-v0-3-0-20260301000000 manual-by-hand \\",
        "    gp-x-db-before-v0-2-0-20260201000000 gp-x-db-before-v0-4-0-20260401000000; echo",
        `else echo "$4" >> ${JSON.stringify(deleted)}; fi`,
      ].join("\n"),
      { mode: 0o755 },
    );
    const run = (keep: string) =>
      execFileSync("bash", [fileURLToPath(new URL("../../infra/updater/prune-snapshots.sh", import.meta.url)), "gp-x-db", keep], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
        encoding: "utf8",
      });

    expect(run("5")).toContain("keeping all");
    expect(existsSync(deleted)).toBe(false);
    run("2");
    expect(readFileSync(deleted, "utf8").trim().split("\n")).toEqual([
      "gp-x-db-before-v0-2-0-20260201000000",
      "gp-x-db-before-v0-1-0-20260101000000",
    ]);
    expect(() => run("0")).toThrow();
  });
});
