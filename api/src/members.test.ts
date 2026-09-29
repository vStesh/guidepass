import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { localAuthenticator } from "./auth.ts";
import { defaultEnvironments, seedEnvironments, type Db } from "./db/client.ts";
import { createLocalDb } from "./db/local.ts";
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
  db = await createLocalDb();
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
