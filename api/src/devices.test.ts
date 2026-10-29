import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { localAuthenticator } from "./auth.ts";
import { defaultEnvironments, seedEnvironments, type Db } from "./db/client.ts";
import { createTestDb } from "./db/local.ts";
import type { UserDirectory } from "./directory.ts";
import { MAX_DEVICES } from "./routes/devices.ts";

let db: Db;
let app: ReturnType<typeof createApp>;

const owner = "owner@example.com";
const anna = "anna@example.com";
const directory: UserDirectory = { ensureUser: async () => "exists" };

async function call(method: string, path: string, as: string, body?: unknown, team?: string) {
  const response = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-local-user": as, ...(team ? { "x-guidepass-team": team } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

const iphone = { name: "Work iPhone", platform: "ios", model: "iPhone 15 Pro", os: "iOS 18.1", details: "dark mode" };

beforeEach(async () => {
  db = await createTestDb();
  await seedEnvironments(db, defaultEnvironments);
  app = createApp({ db, authenticate: localAuthenticator, directory });
  await call("POST", "/setup", owner, { teamName: "Acme" });
  await call("POST", "/invitations", owner, { email: anna });
});

describe("saved devices", () => {
  it("saves, lists, edits and deletes a member's own devices", async () => {
    const created = await call("POST", "/devices", anna, iphone);
    expect(created.status).toBe(201);
    expect(created.body.device).toMatchObject(iphone);
    const id = created.body.device.id;

    await call("POST", "/devices", anna, { name: "Android", platform: "android", model: "Pixel 8" });
    const list = await call("GET", "/devices", anna);
    expect(list.body.devices.map((d: { name: string }) => d.name)).toEqual(["Android", "Work iPhone"]);
    expect(list.body.devices[0]).toMatchObject({ os: null, details: null });

    // An empty string clears an optional field.
    const edited = await call("PATCH", `/devices/${id}`, anna, { os: "iOS 18.2", details: "" });
    expect(edited.body.device).toMatchObject({ os: "iOS 18.2", details: null, model: "iPhone 15 Pro" });

    expect((await call("DELETE", `/devices/${id}`, anna)).status).toBe(200);
    expect((await call("GET", "/devices", anna)).body.devices).toHaveLength(1);
  });

  it("keeps everyone's devices to themselves, owners included", async () => {
    const { body } = await call("POST", "/devices", anna, iphone);
    expect((await call("GET", "/devices", owner)).body.devices).toEqual([]);
    expect((await call("PATCH", `/devices/${body.device.id}`, owner, { name: "Mine" })).status).toBe(404);
    expect((await call("DELETE", `/devices/${body.device.id}`, owner)).status).toBe(404);
    expect((await call("GET", "/devices", anna)).body.devices[0].name).toBe("Work iPhone");
  });

  it("checks the fields and the number of devices", async () => {
    expect((await call("POST", "/devices", anna, { ...iphone, model: " " })).status).toBe(422);
    expect((await call("POST", "/devices", anna, { ...iphone, platform: "iOS 18" })).status).toBe(422);
    expect((await call("POST", "/devices", anna, { ...iphone, details: "x".repeat(81) })).status).toBe(422);
    expect((await call("PATCH", `/devices/${crypto.randomUUID()}`, anna, {})).status).toBe(422);

    for (let i = 0; i < MAX_DEVICES; i++) await call("POST", "/devices", anna, { ...iphone, name: `Phone ${i}` });
    expect((await call("POST", "/devices", anna, iphone)).status).toBe(422);
  });

  it("keeps a person's devices in all their teams, and forgets them when they leave the last", async () => {
    await call("POST", "/devices", anna, iphone);
    const annaId = (await call("GET", "/me", anna)).body.user.id;
    const second = (await call("POST", "/teams", owner, { name: "Second" })).body.team.id;
    await call("POST", "/invitations", owner, { email: anna }, second);
    await call("GET", "/me", anna); // joins on the next sign-in
    expect((await call("GET", "/devices", anna, undefined, second)).body.devices).toHaveLength(1);

    // Leaving one team keeps them; leaving the last one forgets them.
    await call("DELETE", `/members/${encodeURIComponent(annaId)}`, owner);
    expect((await call("GET", "/devices", anna, undefined, second)).body.devices).toHaveLength(1);
    await call("DELETE", `/members/${encodeURIComponent(annaId)}`, owner, undefined, second);
    await call("POST", "/invitations", owner, { email: anna });
    expect((await call("GET", "/devices", anna)).body.devices).toEqual([]);
  });

  it("needs a team", async () => {
    expect((await call("GET", "/devices", "stranger@example.com")).status).toBe(403);
  });
});
