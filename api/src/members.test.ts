import { beforeEach, describe, expect, it } from "vitest";
import example from "@guidepass/schema/examples/build-179.json" with { type: "json" };
import { createApp } from "./app.ts";
import { localAuthenticator } from "./auth.ts";
import { defaultEnvironments, seedEnvironments, type Db } from "./db/client.ts";
import { createTestDb } from "./db/local.ts";
import type { EnsureResult, UserDirectory } from "./directory.ts";

let db: Db;
let app: ReturnType<typeof createApp>;
let directoryAnswer: EnsureResult;

const owner = "owner@example.com";
const anna = "anna@example.com";

const directory: UserDirectory = { ensureUser: async () => directoryAnswer };

async function call(method: string, path: string, as: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-local-user": as },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

beforeEach(async () => {
  db = await createTestDb();
  await seedEnvironments(db, defaultEnvironments);
  directoryAnswer = "exists";
  app = createApp({ db, authenticate: localAuthenticator, directory });
  await call("POST", "/setup", owner, { teamName: "Svitlofour" });
});

describe("invitations", () => {
  it("lets an invited person join on first sign-in", async () => {
    const invited = await call("POST", "/invitations", owner, { email: "Anna@Example.com" });
    expect(invited.status).toBe(201);
    expect(invited.body).toMatchObject({ invitation: { email: anna, role: "tester" }, accountCreated: false });

    const me = await call("GET", "/me", anna);
    expect(me.body.team).toMatchObject({ name: "Svitlofour", role: "tester" });
    expect((await call("GET", "/invitations", owner)).body.invitations).toHaveLength(0);
    expect((await call("GET", "/members", owner)).body.members.map((m: { email: string }) => m.email)).toEqual([
      anna,
      owner,
    ]);
  });

  it("names the person from the invitation, unless they already have a name", async () => {
    await call("POST", "/invitations", owner, { email: anna, name: "Anna" });
    // Inviting again with another spelling updates the pending invitation.
    const again = await call("POST", "/invitations", owner, { email: anna, name: "Anna K." });
    expect(again.body.invitation.name).toBe("Anna K.");
    expect((await call("GET", "/me", anna)).body.user.name).toBe("Anna K.");
    expect((await call("GET", "/members", owner)).body.members.find((m: { email: string }) => m.email === anna).name).toBe("Anna K.");

    const bob = "bob@example.com";
    await call("GET", "/me", bob);
    await call("PATCH", "/me", bob, { name: "Bob" });
    await call("POST", "/invitations", owner, { email: bob, name: "Robert" });
    expect((await call("GET", "/me", bob)).body.user.name).toBe("Bob");
  });

  it("joins through any team route, not only /me", async () => {
    await call("POST", "/invitations", owner, { email: anna });
    expect((await call("GET", "/apps", anna)).status).toBe(200);
  });

  it("reports when a new account was created in Guidepass's own pool", async () => {
    directoryAnswer = "created";
    const res = await call("POST", "/invitations", owner, { email: anna });
    expect(res.body.accountCreated).toBe(true);
  });

  it("refuses people without an account in a shared pool", async () => {
    directoryAnswer = "missing";
    const res = await call("POST", "/invitations", owner, { email: anna });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual({ reason: "no_account" });
  });

  it("resends instead of duplicating a pending invitation", async () => {
    const first = await call("POST", "/invitations", owner, { email: anna });
    directoryAnswer = "created";
    const again = await call("POST", "/invitations", owner, { email: anna });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ invitation: { id: first.body.invitation.id }, accountCreated: true });
    expect((await call("GET", "/invitations", owner)).body.invitations).toHaveLength(1);
  });

  it("rejects members and testers inviting", async () => {
    await call("POST", "/invitations", owner, { email: anna });
    expect((await call("POST", "/invitations", owner, { email: owner })).status).toBe(409);
    await call("GET", "/me", anna);
    expect((await call("POST", "/invitations", anna, { email: "x@example.com" })).status).toBe(403);
  });

  it("revokes pending invitations", async () => {
    const invited = await call("POST", "/invitations", owner, { email: anna });
    expect((await call("DELETE", `/invitations/${invited.body.invitation.id}`, owner)).status).toBe(200);
    expect((await call("GET", "/me", anna)).body.team).toBeNull();
    expect((await call("DELETE", `/invitations/${invited.body.invitation.id}`, owner)).status).toBe(404);
  });

  it("does not let uninvited people in", async () => {
    expect((await call("GET", "/me", anna)).body.team).toBeNull();
    expect((await call("GET", "/apps", anna)).status).toBe(403);
  });
});

describe("members", () => {
  beforeEach(async () => {
    await call("POST", "/invitations", owner, { email: anna });
    await call("GET", "/me", anna);
  });

  it("changes roles and keeps at least one owner", async () => {
    expect((await call("PATCH", `/members/local:${owner}`, owner, { role: "tester" })).status).toBe(409);
    expect((await call("PATCH", `/members/local:${anna}`, owner, { role: "owner" })).status).toBe(200);
    expect((await call("PATCH", `/members/local:${owner}`, owner, { role: "tester" })).status).toBe(200);
    expect((await call("GET", "/me", owner)).body.team.role).toBe("tester");
  });

  it("removes members, but not the last owner", async () => {
    expect((await call("DELETE", `/members/local:${owner}`, owner)).status).toBe(409);
    expect((await call("DELETE", `/members/local:${anna}`, owner)).status).toBe(200);
    expect((await call("GET", "/apps", anna)).status).toBe(403);
    expect((await call("DELETE", `/members/local:${anna}`, owner)).status).toBe(404);
  });
});

describe("writers", () => {
  const bohdan = "bohdan@example.com";
  let appId: string;

  beforeEach(async () => {
    await call("POST", "/invitations", owner, { email: anna, role: "writer" });
    await call("GET", "/me", anna);
    await call("POST", "/invitations", owner, { email: bohdan });
    await call("GET", "/me", bohdan);
    appId = (await call("POST", "/apps", owner, { slug: "acme-mobile", name: "Acme", platforms: ["ios", "android"] })).body.app.id;
  });

  it("maintain guides and areas, but not the team or apps", async () => {
    expect((await call("GET", "/me", anna)).body.team.role).toBe("writer");
    expect((await call("POST", `/apps/${appId}/areas`, anna, { slug: "comments", name: "Comments" })).status).toBe(201);
    const uploaded = await call("POST", `/apps/${appId}/guides`, anna, { slug: "build-179", content: example });
    expect(uploaded.status).toBe(201);
    expect((await call("PATCH", `/guides/${uploaded.body.guideId}`, anna, { status: "archived" })).status).toBe(200);

    expect((await call("POST", "/apps", anna, { slug: "web", name: "Web", platforms: ["web"] })).status).toBe(403);
    expect((await call("PATCH", `/apps/${appId}`, anna, { name: "Renamed" })).status).toBe(403);
    expect((await call("POST", "/invitations", anna, { email: "x@example.com" })).status).toBe(403);
    expect((await call("POST", "/environments", anna, { key: "qa", name: "QA" })).status).toBe(403);
    // Testers still only run guides.
    expect((await call("POST", `/apps/${appId}/guides`, bohdan, { slug: "build-180", content: example })).status).toBe(403);
  });

  it("create agent tokens only for themselves and see only their own", async () => {
    const own = await call("POST", "/agent-tokens", anna, { name: "Anna's Claude", scope: "write" });
    expect(own.status).toBe(201);
    expect(own.body.token).toMatchObject({ userId: `local:${anna}` });
    expect((await call("POST", "/agent-tokens", anna, { name: "x", scope: "write", userId: `local:${bohdan}` })).status).toBe(403);
    expect((await call("POST", "/agent-tokens", bohdan, { name: "x", scope: "read" })).status).toBe(403);

    const ownerToken = (await call("POST", "/agent-tokens", owner, { name: "Owner's", scope: "read" })).body.token;
    const bohdanToken = (await call("POST", "/agent-tokens", owner, { name: "Bohdan's", scope: "write", userId: `local:${bohdan}` })).body.token;

    const names = async (as: string) => (await call("GET", "/agent-tokens", as)).body.tokens.map((t: { name: string }) => t.name).sort();
    expect(await names(anna)).toEqual(["Anna's Claude"]);
    expect(await names(bohdan)).toEqual(["Bohdan's"]);
    expect(await names(owner)).toEqual(["Anna's Claude", "Bohdan's", "Owner's"]);

    expect((await call("PATCH", `/agent-tokens/${own.body.token.id}`, anna, { userId: `local:${bohdan}` })).status).toBe(403);
    expect((await call("DELETE", `/agent-tokens/${ownerToken.id}`, anna)).status).toBe(404);
    expect((await call("DELETE", `/agent-tokens/${bohdanToken.id}`, bohdan)).status).toBe(200);
    expect((await call("DELETE", `/agent-tokens/${own.body.token.id}`, anna)).status).toBe(200);
  });
});

