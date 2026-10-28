import { beforeEach, describe, expect, it } from "vitest";
import example from "@guidepass/schema/examples/build-179.json" with { type: "json" };
import { createApp } from "./app.ts";
import { localAuthenticator } from "./auth.ts";
import { defaultEnvironments, seedEnvironments, type Db } from "./db/client.ts";
import { createTestDb } from "./db/local.ts";
import type { UserDirectory } from "./directory.ts";
import { listAppsWithAreas } from "./services/catalog.ts";

let db: Db;
let app: ReturnType<typeof createApp>;
let teamId: string;
let appId: string;
let guideId: string;

const owner = "owner@example.com";
const anna = "anna@example.com";
const directory: UserDirectory = { ensureUser: async () => "exists" };

async function call(method: string, path: string, as: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-local-user": as },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

const run = { environment: "dev", platform: "ios", device: "iPhone 15", build: "179" };

beforeEach(async () => {
  db = await createTestDb();
  await seedEnvironments(db, defaultEnvironments);
  app = createApp({ db, authenticate: localAuthenticator, directory });
  teamId = (await call("POST", "/setup", owner, { teamName: "Acme" })).body.team.id;
  await call("POST", "/invitations", owner, { email: anna, role: "writer" });
  appId = (await call("POST", "/apps", owner, { slug: "old-app", name: "Old app", platforms: ["ios", "android"] })).body.app.id;
  guideId = (await call("POST", `/apps/${appId}/guides`, owner, { slug: "build-179", content: example })).body.guideId;
});

describe("archived apps", () => {
  it("are hidden from lists and agents, but their guides stay readable", async () => {
    expect((await call("PATCH", `/apps/${appId}`, anna, { archived: true })).status).toBe(403);
    const archived = await call("PATCH", `/apps/${appId}`, owner, { archived: true });
    expect(archived.body.app).toMatchObject({ archived: true, name: "Old app" });

    // The web app still lists it, marked, so owners can restore it.
    expect((await call("GET", "/apps", anna)).body.apps[0]).toMatchObject({ id: appId, archived: true });
    expect(await listAppsWithAreas(db, teamId)).toEqual([]);
    expect((await call("GET", "/guides", anna)).body.guides).toEqual([]);
    expect((await call("GET", `/guides?appId=${appId}`, anna)).body.guides).toHaveLength(1);
    expect((await call("GET", `/guides/${guideId}`, anna)).status).toBe(200);
  });

  it("take no new guides, areas or runs until restored", async () => {
    await call("PATCH", `/apps/${appId}`, owner, { archived: true });
    const refused = await call("POST", `/apps/${appId}/guides`, anna, { slug: "build-180", content: example });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details).toEqual({ reason: "app_archived" });
    expect((await call("POST", `/apps/${appId}/areas`, anna, { slug: "auth", name: "Auth" })).status).toBe(422);
    expect((await call("POST", `/guides/${guideId}/runs`, anna, run)).status).toBe(422);

    await call("PATCH", `/apps/${appId}`, owner, { archived: false });
    expect((await call("POST", `/guides/${guideId}/runs`, anna, run)).status).toBe(201);
    expect(await listAppsWithAreas(db, teamId)).toHaveLength(1);
  });
});
