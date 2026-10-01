import { beforeEach, describe, expect, it } from "vitest";
import example from "@guidepass/schema/examples/build-179.json" with { type: "json" };
import { createApp } from "./app.ts";
import { localAuthenticator } from "./auth.ts";
import { defaultEnvironments, seedEnvironments, type Db } from "./db/client.ts";
import { createTestDb } from "./db/local.ts";
import { localDirectory } from "./directory.ts";
import type { Notifier } from "./services/notifications.ts";

let db: Db;
let app: ReturnType<typeof createApp>;
let sent: { url: string; text: string }[];
let failing: boolean;
let appId: string;

const owner = "owner@example.com";
const webhook = "https://hooks.slack.com/services/T000/B000/XXXX";

const notifier: Notifier = async (url, message) => {
  if (failing) throw new Error("Slack is down");
  sent.push({ url, text: message.text });
};

async function call(method: string, path: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-local-user": owner },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

beforeEach(async () => {
  db = await createTestDb();
  await seedEnvironments(db, defaultEnvironments);
  sent = [];
  failing = false;
  app = createApp({
    db,
    authenticate: localAuthenticator,
    directory: localDirectory,
    notifier,
    publicUrl: "https://gp.example.com",
    guideLanguage: "uk",
  });
  await call("POST", "/setup", { teamName: "Svitlofour" });
  appId = (await call("POST", "/apps", { slug: "svt", name: "Svitlofour", platforms: ["ios", "android"] })).body.app.id;
});

describe("Slack settings", () => {
  it("keeps the webhook URL secret everywhere", async () => {
    const saved = await call("PATCH", `/apps/${appId}`, { slack: { webhookUrl: webhook } });
    expect(saved.body.app.slack).toEqual({ configured: true, events: ["guide_created", "guide_updated"] });
    for (const path of ["/apps", `/apps/${appId}`]) {
      expect(JSON.stringify((await call("GET", path)).body)).not.toContain("hooks.slack.com");
    }
  });

  it("accepts only Slack webhook URLs and removes them with null", async () => {
    expect((await call("PATCH", `/apps/${appId}`, { slack: { webhookUrl: "https://evil.example.com/hook" } })).status).toBe(422);
    await call("PATCH", `/apps/${appId}`, { slack: { webhookUrl: webhook } });
    const removed = await call("PATCH", `/apps/${appId}`, { slack: { webhookUrl: null } });
    expect(removed.body.app.slack.configured).toBe(false);
  });

  it("sends a test message and reports Slack errors", async () => {
    expect((await call("POST", `/apps/${appId}/slack/test`)).status).toBe(422);
    await call("PATCH", `/apps/${appId}`, { slack: { webhookUrl: webhook } });
    expect((await call("POST", `/apps/${appId}/slack/test`)).status).toBe(200);
    expect(sent[0]).toMatchObject({ url: webhook });
    expect(sent[0]!.text).toContain("Сповіщення Guidepass налаштовано");
    failing = true;
    const res = await call("POST", `/apps/${appId}/slack/test`);
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain("Slack is down");
  });
});

describe("notifications", () => {
  beforeEach(async () => {
    await call("PATCH", `/apps/${appId}`, { slack: { webhookUrl: webhook, events: ["guide_created", "guide_updated", "run_problems"] } });
  });

  it("announces a new guide with type, environments and scenario count", async () => {
    await call("POST", `/apps/${appId}/guides`, { slug: "build-179", content: example, dryRun: true });
    expect(sent).toHaveLength(0);
    const { guideId } = (await call("POST", `/apps/${appId}/guides`, { slug: "build-179", content: example })).body;
    expect(sent).toHaveLength(1);
    const text = sent[0]!.text;
    expect(text).toContain(`<https://gp.example.com/guides/${guideId}|Build 179`);
    expect(text).toContain("Фіча");
    expect(text).toContain("Development, Staging");
    expect(text).toContain("сценаріїв: 3 (ключових: 1)");
  });

  it("announces a new version with how many scenarios to retest", async () => {
    await call("POST", `/apps/${appId}/guides`, { slug: "build-179", content: example });
    const next = structuredClone(example);
    next.scenarios[0]!.expected = "Changed";
    await call("POST", `/apps/${appId}/guides`, { slug: "build-179", content: next, changeNote: "Fix <thread> & order", baseVersion: 1 });
    const text = sent[1]!.text;
    expect(text).toContain("Нова версія v2");
    expect(text).toContain("Fix &lt;thread&gt; &amp; order");
    expect(text).toContain("перетестувати сценаріїв: 1");
  });

  it("announces a finished run only when it has problems", async () => {
    const { guideId } = (await call("POST", `/apps/${appId}/guides`, { slug: "build-179", content: example })).body;
    const clean = (await call("POST", `/guides/${guideId}/runs`, { environment: "dev", platform: "ios", device: "iPhone 15", build: "179" })).body.run.id;
    await call("PUT", `/runs/${clean}/results/reply-to-comment`, { status: "pass" });
    await call("PATCH", `/runs/${clean}`, { finished: true });
    expect(sent).toHaveLength(1);

    const bad = (await call("POST", `/guides/${guideId}/runs`, { environment: "dev", platform: "ios", device: "iPhone 12", build: "179" })).body.run.id;
    await call("PUT", `/runs/${bad}/results/reply-to-comment`, { status: "fail", evidence: "Screenshot in #215" });
    await call("PATCH", `/runs/${bad}`, { finished: true });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toContain("Прохід завершено з проблемами");
    expect(sent[1]!.text).toContain("iPhone 12: ❌ помилок: 1");
    expect(sent[1]!.text).toContain("owner ·");
    expect(sent[1]!.text).not.toContain("@example.com");

    await call("PATCH", `/runs/${bad}`, { finished: true });
    expect(sent).toHaveLength(2);
  });

  it("respects the chosen events and never fails an upload when Slack is down", async () => {
    await call("PATCH", `/apps/${appId}`, { slack: { events: ["guide_updated"] } });
    await call("POST", `/apps/${appId}/guides`, { slug: "build-179", content: example });
    expect(sent).toHaveLength(0);

    await call("PATCH", `/apps/${appId}`, { slack: { events: ["guide_created"] } });
    failing = true;
    const res = await call("POST", `/apps/${appId}/guides`, { slug: "build-180", content: example });
    expect(res.status).toBe(201);
  });
});
