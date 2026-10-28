import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { localAuthenticator } from "./auth.ts";
import { defaultEnvironments, seedEnvironments, type Db } from "./db/client.ts";
import { createTestDb } from "./db/local.ts";
import type { UserDirectory } from "./directory.ts";

let db: Db;
let app: ReturnType<typeof createApp>;
let first: string;

const owner = "owner@example.com";
const anna = "anna@example.com";
const directory: UserDirectory = { ensureUser: async () => "exists" };

async function call(method: string, path: string, as: string, body?: unknown, team?: string) {
  const response = await app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-local-user": as,
      ...(team ? { "x-guidepass-team": team } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

const mobileApp = (slug: string) => ({ slug, name: slug, platforms: ["ios", "android"] });

beforeEach(async () => {
  db = await createTestDb();
  await seedEnvironments(db, defaultEnvironments);
  app = createApp({ db, authenticate: localAuthenticator, directory });
  first = (await call("POST", "/setup", owner, { teamName: "ListUp" })).body.team.id;
});

describe("several teams", () => {
  it("lets the instance admin create a team and work in either", async () => {
    const created = await call("POST", "/teams", owner, { name: "Школа+" });
    expect(created.status).toBe(201);
    const second = created.body.team.id;

    const me = await call("GET", "/me", owner);
    expect(me.body).toMatchObject({ team: { id: first, name: "ListUp", role: "owner" }, instanceAdmin: true });
    expect(me.body.teams.map((t: { name: string }) => t.name)).toEqual(["ListUp", "Школа+"]);
    expect((await call("GET", "/me", owner, undefined, second)).body.team).toMatchObject({ id: second, name: "Школа+" });

    // Apps belong to the team the request names.
    await call("POST", "/apps", owner, mobileApp("listup-app"));
    await call("POST", "/apps", owner, mobileApp("schoolplus-mobile"), second);
    const slugs = async (team?: string) => (await call("GET", "/apps", owner, undefined, team)).body.apps.map((a: { slug: string }) => a.slug);
    expect(await slugs()).toEqual(["listup-app"]);
    expect(await slugs(second)).toEqual(["schoolplus-mobile"]);
  });

  it("keeps people of one team out of another", async () => {
    const second = (await call("POST", "/teams", owner, { name: "Школа+" })).body.team.id;
    await call("POST", "/apps", owner, mobileApp("schoolplus-mobile"), second);
    await call("POST", "/invitations", owner, { email: anna, role: "owner" }, second);

    const me = await call("GET", "/me", anna);
    expect(me.body).toMatchObject({ team: { id: second, role: "owner" }, instanceAdmin: false });
    expect(me.body.teams).toHaveLength(1);
    // Naming a team they are not in finds nothing; /me falls back to their own team.
    expect((await call("GET", "/apps", anna, undefined, first)).status).toBe(403);
    expect((await call("GET", "/members", anna, undefined, first)).status).toBe(403);
    expect((await call("GET", "/me", anna, undefined, first)).body.team.id).toBe(second);
    expect((await call("GET", "/members", owner, undefined, first)).body.members).toHaveLength(1);
  });

  it("joins a second team on the next sign-in, and leaves one without losing the other", async () => {
    await call("POST", "/invitations", owner, { email: anna });
    await call("GET", "/me", anna);
    const second = (await call("POST", "/teams", owner, { name: "Школа+" })).body.team.id;
    await call("POST", "/invitations", owner, { email: anna, role: "writer" }, second);

    const me = await call("GET", "/me", anna);
    expect(me.body.teams.map((t: { name: string; role: string }) => `${t.name}:${t.role}`)).toEqual(["ListUp:tester", "Школа+:writer"]);

    const annaId = me.body.user.id;
    await call("DELETE", `/members/${encodeURIComponent(annaId)}`, owner, undefined, second);
    expect((await call("GET", "/me", anna)).body.teams).toHaveLength(1);
    expect((await call("GET", "/apps", anna)).status).toBe(200);
  });

  it("leaves the instance to the first team's owners", async () => {
    const second = (await call("POST", "/teams", owner, { name: "Школа+" })).body.team.id;
    await call("POST", "/invitations", owner, { email: anna, role: "owner" }, second);
    await call("GET", "/me", anna);

    expect((await call("POST", "/teams", anna, { name: "Mine" })).status).toBe(403);
    expect((await call("POST", "/environments", anna, { key: "qa", name: "QA" })).status).toBe(403);
    expect((await call("PATCH", "/environments/dev", anna, { name: "Dev" })).status).toBe(403);
    expect((await call("GET", "/updates", anna)).status).toBe(403);
    // Everyone still sees the shared environments, and runs their own team.
    expect((await call("GET", "/environments", anna)).status).toBe(200);
    expect((await call("POST", "/invitations", anna, { email: "bob@example.com" })).status).toBe(201);
    expect((await call("POST", "/environments", owner, { key: "qa", name: "QA" })).status).toBe(201);
  });

  it("lets owners rename their team", async () => {
    await call("POST", "/invitations", owner, { email: anna });
    expect((await call("PATCH", "/team", anna, { name: "Mine" })).status).toBe(403);
    expect((await call("PATCH", "/team", owner, { name: "ListUp QA" })).body.team.name).toBe("ListUp QA");
    expect((await call("GET", "/me", owner)).body.team.name).toBe("ListUp QA");
  });
});
