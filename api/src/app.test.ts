import { beforeEach, describe, expect, it } from "vitest";
import example from "@guidepass/schema/examples/build-179.json" with { type: "json" };
import { createApp } from "./app.ts";
import { localAuthenticator } from "./auth.ts";
import { localDirectory } from "./directory.ts";
import type { Db } from "./db/client.ts";
import { defaultEnvironments, seedEnvironments } from "./db/client.ts";
import { createTestDb } from "./db/local.ts";
import { guideVersions, memberships, results, runs } from "./db/schema.ts";

let db: Db;
let app: ReturnType<typeof createApp>;

async function call(method: string, path: string, options: { as?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.as !== undefined) headers["x-local-user"] = options.as;
  const response = await app.request(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

const owner = "owner@example.com";
const tester = "tester@example.com";

async function setUpApp() {
  await call("POST", "/setup", { as: owner, body: { teamName: "Acme" } });
  const created = await call("POST", "/apps", {
    as: owner,
    body: { slug: "acme-mobile", name: "Acme", platforms: ["ios", "android"] },
  });
  return created.body.app.id as string;
}

beforeEach(async () => {
  db = await createTestDb();
  await seedEnvironments(db, defaultEnvironments);
  app = createApp({ db, authenticate: localAuthenticator, directory: localDirectory });
});

describe("auth and setup", () => {
  it("answers health checks without signing in", async () => {
    expect((await call("GET", "/health")).status).toBe(200);
  });

  it("rejects requests without a user", async () => {
    const res = await call("GET", "/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthenticated");
  });

  it("lets the first user set up the instance, once", async () => {
    expect((await call("GET", "/me", { as: owner })).body.team).toBeNull();
    expect((await call("POST", "/setup", { as: owner, body: { teamName: "Team" } })).status).toBe(201);
    expect((await call("GET", "/me", { as: owner })).body.team).toMatchObject({ name: "Team", role: "owner" });
    expect((await call("POST", "/setup", { as: tester, body: { teamName: "Other" } })).status).toBe(409);
  });

  it("restricts setup to the configured owner email", async () => {
    app = createApp({ db, authenticate: localAuthenticator, directory: localDirectory, ownerEmail: "Owner@Example.com" });
    expect((await call("POST", "/setup", { as: tester, body: { teamName: "Mine" } })).status).toBe(403);
    expect((await call("POST", "/setup", { as: owner, body: { teamName: "Team" } })).status).toBe(201);
  });

  it("lets a person back in after their account is recreated with the same email", async () => {
    expect((await call("GET", "/me", { as: owner })).status).toBe(200);
    const other = createApp({
      db,
      authenticate: async () => ({ sub: "new-sub", email: owner }),
      directory: localDirectory,
    });
    expect((await other.request("/me")).status).toBe(200);
  });

  it("hides environments from people outside the team", async () => {
    await setUpApp();
    expect((await call("GET", "/environments", { as: tester })).status).toBe(403);
  });

  it("lists the seeded environments in order", async () => {
    await setUpApp();
    const res = await call("GET", "/environments", { as: owner });
    expect(res.body.environments.map((e: { key: string }) => e.key)).toEqual(["dev", "stg", "prod"]);
  });
});

describe("apps and areas", () => {
  it("lets owners create apps and areas, and rejects duplicates", async () => {
    const appId = await setUpApp();
    const area = await call("POST", `/apps/${appId}/areas`, {
      as: owner,
      body: { slug: "comments", name: "Comments" },
    });
    expect(area.status).toBe(201);
    const again = await call("POST", `/apps/${appId}/areas`, { as: owner, body: { slug: "comments", name: "X" } });
    expect(again.status).toBe(409);
    expect((await call("GET", `/apps/${appId}`, { as: owner })).body.app.areas).toHaveLength(1);
  });

  it("keeps testers from creating apps", async () => {
    await setUpApp();
    const team = await call("GET", "/me", { as: owner });
    await call("GET", "/me", { as: tester });
    await db.insert(memberships).values({ teamId: team.body.team.id, userId: `local:${tester}`, role: "tester" });

    expect((await call("GET", "/apps", { as: tester })).body.apps).toHaveLength(1);
    const res = await call("POST", "/apps", {
      as: tester,
      body: { slug: "other", name: "Other", platforms: ["web"] },
    });
    expect(res.status).toBe(403);
  });

  it("rejects malformed ids instead of failing", async () => {
    await setUpApp();
    expect((await call("GET", "/apps/not-a-uuid", { as: owner })).status).toBe(422);
    expect((await call("GET", "/guides/not-a-uuid", { as: owner })).status).toBe(422);
  });

  it("reports body validation errors in the API format", async () => {
    await setUpApp();
    const res = await call("POST", "/apps", { as: owner, body: { slug: "Bad Slug", name: "", platforms: [] } });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(["/slug", "/name", "/platforms"]),
    );
  });
});

describe("guides", () => {
  it("validates, dry-runs, creates and versions a guide", async () => {
    const appId = await setUpApp();
    const upload = (body: object) => call("POST", `/apps/${appId}/guides`, { as: owner, body });

    const invalid = await upload({ slug: "build-179", content: { ...example, environments: ["qa"] } });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.details).toContainEqual({ path: "/environments/0", message: 'unknown environment "qa"' });

    const dry = await upload({ slug: "build-179", content: example, dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ guideId: null, version: 1, dryRun: true });
    expect((await call("GET", `/apps/${appId}/guides?status=all`, { as: owner })).body.guides).toHaveLength(0);

    const typo = await upload({ slug: "build-197", content: example, baseVersion: 1, changeNote: "x" });
    expect(typo.status).toBe(404);

    const created = await upload({ slug: "build-179", content: example });
    expect(created.status).toBe(201);
    expect(created.body.diff.added).toHaveLength(4);
    const guideId = created.body.guideId;

    const next = structuredClone(example);
    next.scenarios[0]!.expected = "Changed";
    expect((await upload({ slug: "build-179", content: next, changeNote: "x" })).status).toBe(409);
    expect((await upload({ slug: "build-179", content: next, changeNote: "x", baseVersion: 2 })).status).toBe(409);
    expect((await upload({ slug: "build-179", content: next, baseVersion: 1 })).status).toBe(422);

    const v2 = await upload({ slug: "build-179", content: next, changeNote: "Clarify reply check", baseVersion: 1 });
    expect(v2.status).toBe(201);
    expect(v2.body).toMatchObject({ version: 2, diff: { changed: ["reply-to-comment"] } });

    const read = await call("GET", `/guides/${guideId}`, { as: owner });
    expect(read.body).toMatchObject({ version: 2, guide: { currentVersion: 2, environments: ["dev", "stg"] } });
    expect(read.body.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect((await call("GET", `/guides/${guideId}?version=1`, { as: owner })).body.content.scenarios[0].expected)
      .toBe(example.scenarios[0]!.expected);
  });

  it("refuses to drop a scenario that already has results", async () => {
    const appId = await setUpApp();
    const created = await call("POST", `/apps/${appId}/guides`, { as: owner, body: { slug: "build-179", content: example } });
    const [version] = await db.select({ id: guideVersions.id }).from(guideVersions);
    const [run] = await db
      .insert(runs)
      .values({ guideVersionId: version!.id, testerId: `local:${owner}`, environmentKey: "dev", platform: "ios", device: "iPhone" })
      .returning();
    await db.insert(results).values({ runId: run!.id, scenarioKey: "reply-to-comment", status: "pass" });

    const next = structuredClone(example);
    next.scenarios.splice(0, 2);
    const res = await call("POST", `/apps/${appId}/guides`, {
      as: owner,
      body: { slug: "build-179", content: next, changeNote: "Trim", baseVersion: 1 },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual({ keys: ["reply-to-comment"] });
    expect(created.status).toBe(201);
  });

  it("lists guides with filters and archives them", async () => {
    const appId = await setUpApp();
    const created = await call("POST", `/apps/${appId}/guides`, { as: owner, body: { slug: "build-179", content: example } });
    const list = (query: string) => call("GET", `/apps/${appId}/guides${query}`, { as: owner });

    expect((await list("")).body.guides).toHaveLength(1);
    expect((await list("?environment=stg")).body.guides).toHaveLength(1);
    expect((await list("?environment=prod")).body.guides).toHaveLength(0);
    expect((await list("?build=179")).body.guides).toHaveLength(1);

    await call("PATCH", `/guides/${created.body.guideId}`, { as: owner, body: { status: "archived" } });
    expect((await list("")).body.guides).toHaveLength(0);
    expect((await list("?status=all")).body.guides).toHaveLength(1);
  });
});

describe("limits", () => {
  it("refuses request bodies over 256 KB", async () => {
    const res = await app.request("/setup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-local-user": owner },
      body: JSON.stringify({ teamName: "x".repeat(300 * 1024) }),
    });
    expect(res.status).toBe(413);
  });
});

