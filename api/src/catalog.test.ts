import { beforeEach, describe, expect, it } from "vitest";
import example from "@guidepass/schema/examples/build-179.json" with { type: "json" };
import { createApp } from "./app.ts";
import { localAuthenticator } from "./auth.ts";
import { defaultEnvironments, seedEnvironments, type Db } from "./db/client.ts";
import { createLocalDb } from "./db/local.ts";
import { localDirectory } from "./directory.ts";
import { memberships } from "./db/schema.ts";

let db: Db;
let app: ReturnType<typeof createApp>;

const owner = "owner@example.com";
const tester = "tester@example.com";

async function call(method: string, path: string, body?: unknown, as = owner) {
  const response = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-local-user": as },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

beforeEach(async () => {
  db = await createLocalDb();
  await seedEnvironments(db, defaultEnvironments);
  app = createApp({ db, authenticate: localAuthenticator, directory: localDirectory });
  await call("POST", "/setup", { teamName: "Svitlofour" });
  const team = (await call("GET", "/me")).body.team;
  await call("GET", "/me", undefined, tester);
  await db.insert(memberships).values({ teamId: team.id, userId: `local:${tester}`, role: "tester" });
});

describe("platforms", () => {
  it("takes built-in platforms including api, and named custom ones", async () => {
    const missingName = await call("POST", "/apps", { slug: "svt", name: "Svitlofour", platforms: ["ios", "api", "admin"] });
    expect(missingName.status).toBe(422);
    expect(missingName.body.error.details).toEqual({ platforms: ["admin"] });

    const created = await call("POST", "/apps", {
      slug: "svt",
      name: "Svitlofour",
      platforms: ["ios", "api", "admin"],
      platformNames: { admin: "Admin panel" },
    });
    expect(created.status).toBe(201);
    expect(created.body.app).toMatchObject({ platforms: ["ios", "api", "admin"], platformNames: { admin: "Admin panel" } });
  });

  it("rejects guides that use a platform the app doesn't have", async () => {
    const appId = (await call("POST", "/apps", { slug: "svt", name: "S", platforms: ["ios"] })).body.app.id;
    const res = await call("POST", `/apps/${appId}/guides`, { slug: "build-179", content: example });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe("/scenarios/1/platforms/0");
  });

  it("changes platforms, but keeps the ones that have runs", async () => {
    const appId = (await call("POST", "/apps", { slug: "svt", name: "S", platforms: ["ios", "android"] })).body.app.id;
    const guideId = (await call("POST", `/apps/${appId}/guides`, { slug: "build-179", content: example })).body.guideId;
    await call("POST", `/guides/${guideId}/runs`, { environment: "dev", platform: "ios", device: "iPhone" });

    const added = await call("PATCH", `/apps/${appId}`, { platforms: ["ios", "android", "api"] });
    expect(added.body.app.platforms).toEqual(["ios", "android", "api"]);

    expect((await call("PATCH", `/apps/${appId}`, { platforms: ["android", "api"] })).status).toBe(409);
    expect((await call("PATCH", `/apps/${appId}`, { platforms: ["ios", "android"] })).status).toBe(200);
    expect((await call("PATCH", `/apps/${appId}`, { name: "X" }, tester)).status).toBe(403);
  });

  it("keeps platforms that active guides' scenarios use, and drops names of removed ones", async () => {
    const appId = (
      await call("POST", "/apps", {
        slug: "svt",
        name: "S",
        platforms: ["ios", "android", "admin"],
        platformNames: { admin: "Admin", ios: "ignored" },
      })
    ).body.app.id;
    await call("POST", `/apps/${appId}/guides`, { slug: "build-179", content: example });

    const res = await call("PATCH", `/apps/${appId}`, { platforms: ["ios", "admin"] });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ guides: ["build-179"] });

    const dropped = await call("PATCH", `/apps/${appId}`, { platforms: ["ios", "android"] });
    expect(dropped.body.app.platformNames).toEqual({});
  });

  it("starts runs on the api platform", async () => {
    const appId = (await call("POST", "/apps", { slug: "svt", name: "S", platforms: ["ios", "android", "api"] })).body.app.id;
    const guideId = (await call("POST", `/apps/${appId}/guides`, { slug: "build-179", content: example })).body.guideId;
    const run = await call("POST", `/guides/${guideId}/runs`, { environment: "dev", platform: "api", device: "Postman" });
    expect(run.status).toBe(201);
    expect(run.body.run.platform).toBe("api");
  });
});

describe("guide type", () => {
  it("is stored from the content and filters the list", async () => {
    const appId = (await call("POST", "/apps", { slug: "svt", name: "S", platforms: ["ios", "android"] })).body.app.id;
    await call("POST", `/apps/${appId}/guides`, { slug: "build-179", content: example });
    await call("POST", `/apps/${appId}/guides`, { slug: "build-180", content: { ...example, type: "bugfix" } });

    const all = (await call("GET", `/apps/${appId}/guides`)).body.guides;
    expect(all.map((g: { slug: string; type: string }) => [g.slug, g.type]).sort()).toEqual([
      ["build-179", "feature"],
      ["build-180", "bugfix"],
    ]);
    const fixes = (await call("GET", `/apps/${appId}/guides?type=bugfix`)).body.guides;
    expect(fixes.map((g: { slug: string }) => g.slug)).toEqual(["build-180"]);
  });
});

describe("environments", () => {
  const keys = async () => (await call("GET", "/environments")).body.environments.map((e: { key: string }) => e.key);

  it("adds, renames, reorders and archives", async () => {
    expect((await call("POST", "/environments", { key: "qa", name: "QA" })).status).toBe(201);
    expect(await keys()).toEqual(["dev", "stg", "prod", "qa"]);
    expect((await call("POST", "/environments", { key: "qa", name: "Again" })).status).toBe(409);

    await call("PATCH", "/environments/stg", { name: "Stage" });
    await call("PUT", "/environments/order", { keys: ["dev", "qa", "stg", "prod"] });
    const list = (await call("GET", "/environments")).body.environments;
    expect(list.map((e: { key: string; name: string }) => `${e.key}:${e.name}`)).toEqual([
      "dev:Development",
      "qa:QA",
      "stg:Stage",
      "prod:Production",
    ]);

    expect((await call("PUT", "/environments/order", { keys: ["dev", "qa"] })).status).toBe(422);
    expect((await call("POST", "/environments", { key: "x", name: "X" }, tester)).status).toBe(403);
  });

  it("keeps archived environments out of new guides and keeps one active", async () => {
    const appId = (await call("POST", "/apps", { slug: "svt", name: "S", platforms: ["ios", "android"] })).body.app.id;
    await call("PATCH", "/environments/stg", { archived: true });
    const res = await call("POST", `/apps/${appId}/guides`, { slug: "build-179", content: example });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toContainEqual({ path: "/environments/1", message: 'unknown environment "stg"' });

    await call("PATCH", "/environments/prod", { archived: true });
    expect((await call("PATCH", "/environments/dev", { archived: true })).status).toBe(409);
    expect((await call("PATCH", "/environments/stg", { archived: false })).status).toBe(200);
  });
});
