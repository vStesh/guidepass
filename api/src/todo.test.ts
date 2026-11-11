import { beforeEach, describe, expect, it } from "vitest";
import example from "@guidepass/schema/examples/build-179.json" with { type: "json" };
import { createApp } from "./app.ts";
import { localAuthenticator } from "./auth.ts";
import { defaultEnvironments, seedEnvironments, type Db } from "./db/client.ts";
import { createTestDb } from "./db/local.ts";
import type { UserDirectory } from "./directory.ts";
import { sendDailyDigests, type Notifier } from "./services/notifications.ts";

let db: Db;
let app: ReturnType<typeof createApp>;
let appId: string;
let first: string;
let second: string;

const owner = "owner@example.com";
const anna = "anna@example.com";
const directory: UserDirectory = { ensureUser: async () => "exists" };
const webhook = "https://hooks.slack.com/services/T000/B000/XXXX";

async function call(method: string, path: string, as: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-local-user": as },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

const upload = async (slug: string, title: string) =>
  (await call("POST", `/apps/${appId}/guides`, owner, { slug, content: { ...example, title } })).body.guideId as string;
const startRun = async (as: string, guideId: string) =>
  (await call("POST", `/guides/${guideId}/runs`, as, { environment: "dev", platform: "ios", device: "iPhone 15", build: "179" })).body.run.id as string;

beforeEach(async () => {
  db = await createTestDb();
  await seedEnvironments(db, defaultEnvironments);
  app = createApp({ db, authenticate: localAuthenticator, directory });
  await call("POST", "/setup", owner, { teamName: "Acme" });
  await call("POST", "/invitations", owner, { email: anna });
  await call("GET", "/me", anna);
  appId = (await call("POST", "/apps", owner, { slug: "acme-mobile", name: "Acme mobile", platforms: ["ios", "android"] })).body.app.id;
  first = await upload("build-179", "Build 179");
  second = await upload("build-180", "Build 180");
});

describe("my to-do", () => {
  it("lists unfinished runs, then guides the person hasn't started", async () => {
    let todo = (await call("GET", "/todo", anna)).body;
    expect(todo.runs).toEqual([]);
    expect(todo.waiting.map((g: { title: string; testers: number }) => `${g.title}:${g.testers}`)).toEqual(["Build 180:0", "Build 179:0"]);

    const runId = await startRun(anna, first);
    await call("PUT", `/runs/${runId}/results/reply-to-comment`, anna, { status: "pass" });
    todo = (await call("GET", "/todo", anna)).body;
    expect(todo.runs).toHaveLength(1);
    expect(todo.runs[0]).toMatchObject({ id: runId, guideId: first, title: "Build 179", counts: { pass: 1 } });
    expect(todo.waiting.map((g: { id: string }) => g.id)).toEqual([second]);
    // The owner sees that someone has started Build 179.
    expect((await call("GET", "/todo", owner)).body.waiting.find((g: { id: string }) => g.id === first).testers).toBe(1);

    await call("PATCH", `/runs/${runId}`, anna, { finished: true });
    todo = (await call("GET", "/todo", anna)).body;
    expect(todo.runs).toEqual([]);
    expect(todo.waiting.map((g: { id: string }) => g.id)).toEqual([second]);
  });

  it("leaves out archived guides and apps", async () => {
    await call("PATCH", `/guides/${second}`, owner, { status: "archived" });
    expect((await call("GET", "/todo", anna)).body.waiting.map((g: { id: string }) => g.id)).toEqual([first]);
    await call("PATCH", `/apps/${appId}`, owner, { archived: true });
    expect((await call("GET", "/todo", anna)).body.waiting).toEqual([]);
  });
});

describe("daily digest", () => {
  it("lists the guides nobody has started, only for apps that ask for it", async () => {
    const sent: { url: string; text: string }[] = [];
    const notify: Notifier = async (url, message) => {
      sent.push({ url, text: message.text });
    };
    const ctx = { db, notify, publicUrl: "https://gp.example.com", language: "en" };

    await call("PATCH", `/apps/${appId}`, owner, { slack: { webhookUrl: webhook } });
    expect(await sendDailyDigests(ctx)).toBe(0);

    await call("PATCH", `/apps/${appId}`, owner, { slack: { events: ["guide_created", "daily_digest"] } });
    await startRun(anna, first);
    expect(await sendDailyDigests(ctx, new Date(Date.now() + 3 * 86_400_000))).toBe(1);
    expect(sent[0]!.url).toBe(webhook);
    expect(sent[0]!.text).toContain("Waiting for testing: 1 guide nobody has started");
    expect(sent[0]!.text).toMatch(new RegExp(`/guides/${second}\\?team=[0-9a-f-]{36}\\|Build 180> — 3 days`));
    expect(sent[0]!.text).not.toContain("Build 179");

    // Nothing waiting, nothing sent.
    await startRun(anna, second);
    expect(await sendDailyDigests(ctx)).toBe(0);
  });
});
