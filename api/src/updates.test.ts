import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { localAuthenticator } from "./auth.ts";
import { defaultEnvironments, seedEnvironments, type Db } from "./db/client.ts";
import { createTestDb } from "./db/local.ts";
import { localDirectory } from "./directory.ts";
import { memberships } from "./db/schema.ts";
import type { Updater } from "./updater.ts";
import { compareVersions, VERSION } from "./version.ts";

let db: Db;
let calls: string[];
let answer: () => Response;

const owner = "owner@example.com";
const tester = "tester@example.com";

const COMMIT = "a".repeat(40);

const fakeGitHub: typeof fetch = async (input) => {
  const url = String(input);
  // The tag's commit is looked up along with the release.
  if (url.includes("/git/ref/tags/")) return Response.json({ object: { type: "commit", sha: COMMIT } });
  calls.push(url);
  return answer();
};

const release = (tag: string) =>
  Response.json({
    tag_name: tag,
    name: `Guidepass ${tag}`,
    body: "### Added\n- Update banner",
    html_url: `https://github.com/acme/guidepass/releases/tag/${tag}`,
    published_at: "2026-10-03T10:00:00Z",
  });

/** Runs "started" by the fake updater: id → state. */
let builds: Map<string, { status: "running" | "succeeded" | "failed"; version: string }>;
let withUpdater = false;

const fakeUpdater: Updater = {
  async start(version, commit) {
    expect(commit).toBe(COMMIT);
    const id = `build-${builds.size + 1}`;
    builds.set(id, { status: "running", version });
    return { id };
  },
  async get(id) {
    const build = builds.get(id);
    return build ? { status: build.status, phase: "BUILD", startedAt: null, endedAt: null, log: [`deploying ${build.version}`] } : null;
  },
};

function app(repository: string | null = "acme/guidepass") {
  return createApp({
    db,
    authenticate: localAuthenticator,
    directory: localDirectory,
    updateRepository: repository,
    updateFetch: fakeGitHub,
    updater: withUpdater ? fakeUpdater : null,
  });
}

async function call(path: string, as = owner, repository?: string | null, method = "GET", body?: unknown) {
  const response = await app(repository).request(path, {
    method,
    headers: { "x-local-user": as, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

beforeEach(async () => {
  db = await createTestDb();
  await seedEnvironments(db, defaultEnvironments);
  calls = [];
  builds = new Map();
  withUpdater = false;
  answer = () => release("v99.0.0");
  await app().request("/setup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-local-user": owner },
    body: JSON.stringify({ teamName: "Acme" }),
  });
  const team = (await call("/me")).body.team;
  await call("/me", tester);
  await db.insert(memberships).values({ teamId: team.id, userId: `local:${tester}`, role: "tester" });
});

describe("update check", () => {
  it("tells owners about a newer release and caches the answer for a day", async () => {
    const first = await call("/updates");
    expect(first.body).toMatchObject({
      current: VERSION,
      enabled: true,
      updateAvailable: true,
      latest: { version: "99.0.0", name: "Guidepass v99.0.0", notes: "### Added\n- Update banner", commit: COMMIT },
    });
    expect(calls).toEqual(["https://api.github.com/repos/acme/guidepass/releases/latest"]);

    await call("/updates");
    expect(calls).toHaveLength(1);
    await call("/updates?refresh=1");
    expect(calls).toHaveLength(2);
  });

  it("is quiet when this version is the newest, there are no releases, or GitHub is down", async () => {
    answer = () => release(`v${VERSION}`);
    expect((await call("/updates")).body.updateAvailable).toBe(false);

    answer = () => new Response("{}", { status: 404 });
    expect((await call("/updates?refresh=1")).body).toMatchObject({ updateAvailable: false, latest: null });

    // A failed check keeps the last answer.
    answer = () => release("v99.0.0");
    await call("/updates?refresh=1");
    answer = () => new Response("oops", { status: 500 });
    expect((await call("/updates?refresh=1")).body).toMatchObject({ updateAvailable: true, latest: { version: "99.0.0" } });
  });

  it("can be turned off, and is for owners only", async () => {
    const off = await call("/updates", owner, null);
    expect(off.body).toEqual({ current: VERSION, enabled: false, latest: null, updateAvailable: false, checkedAt: null, canUpdate: false });
    expect(calls).toHaveLength(0);
    expect((await call("/updates", tester)).status).toBe(403);
    expect((await call("/version", tester)).body).toEqual({ version: VERSION });
  });
});

describe("Update button", () => {
  it("is off without an updater", async () => {
    expect((await call("/updates")).body.canUpdate).toBe(false);
    expect((await call("/updates/run", owner, undefined, "POST", { version: "99.0.0" })).status).toBe(404);
  });

  it("updates only to the newest release, owners only, one at a time", async () => {
    withUpdater = true;
    expect((await call("/updates")).body).toMatchObject({ canUpdate: true, updateAvailable: true });
    expect((await call("/updates/run", tester, undefined, "POST", { version: "99.0.0" })).status).toBe(403);
    expect((await call("/updates/run", owner, undefined, "POST", { version: "98.0.0" })).body.error.details.reason).toBe("not_latest");

    const started = await call("/updates/run", owner, undefined, "POST", { version: "99.0.0" });
    expect(started.status).toBe(202);
    expect(started.body.run).toMatchObject({ id: "build-1", version: "99.0.0", from: VERSION });
    expect([...builds.values()]).toEqual([{ status: "running", version: "99.0.0" }]);

    expect((await call("/updates/run", owner, undefined, "POST", { version: "99.0.0" })).body.error.details.reason).toBe("running");
    const watched = await call("/updates/run");
    expect(watched.body.run).toMatchObject({ status: "running", phase: "BUILD", log: ["deploying 99.0.0"] });

    builds.get("build-1")!.status = "failed";
    expect((await call("/updates/run", owner, undefined, "POST", { version: "99.0.0" })).status).toBe(202);
  });

  it("refuses when this instance already runs the newest release", async () => {
    withUpdater = true;
    answer = () => release(`v${VERSION}`);
    expect((await call("/updates/run", owner, undefined, "POST", { version: VERSION })).body.error.details.reason).toBe("not_latest");
  });
});

describe("compareVersions", () => {
  it("orders releases and pre-releases", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
  });
});

describe("updater settings", () => {
  it("save every Terraform variable, so an update applies what the last apply used", () => {
    const infra = (file: string) => readFileSync(new URL(`../../infra/${file}`, import.meta.url), "utf8");
    const declared = [...infra("variables.tf").matchAll(/^variable "([a-z_]+)"/gm)].map((m) => m[1]!);
    const block = infra("updates.tf").match(/instance_variables = \{([\s\S]*?)\n  \}/)![1]!;
    const saved = [...block.matchAll(/^\s+([a-z_]+)\s+=/gm)].map((m) => m[1]!);
    // The state's location is passed by tf.sh and saved separately for the updater.
    expect(saved.sort()).toEqual(declared.filter((name) => !name.startsWith("state_")).sort());
  });
});

