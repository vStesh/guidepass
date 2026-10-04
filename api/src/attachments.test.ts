import { beforeEach, describe, expect, it } from "vitest";
import example from "@guidepass/schema/examples/build-179.json" with { type: "json" };
import { createApp } from "./app.ts";
import { localAuthenticator } from "./auth.ts";
import { defaultEnvironments, seedEnvironments, type Db } from "./db/client.ts";
import { createTestDb } from "./db/local.ts";
import { localDirectory } from "./directory.ts";
import { memberships } from "./db/schema.ts";
import { createMcpHandler } from "./mcp/server.ts";
import type { EvidenceStorage } from "./storage.ts";

let db: Db;
let app: ReturnType<typeof createApp>;
let guideId: string;
/** Objects "in the bucket": key → size and type. */
let bucket: Map<string, { size: number; contentType: string }>;

const owner = "owner@example.com";
const anna = "anna@example.com";
const bohdan = "bohdan@example.com";

const fakeStorage: EvidenceStorage = {
  async presignUpload(key, contentType) {
    return { url: "https://bucket.example/", fields: { key, "Content-Type": contentType } };
  },
  async head(key) {
    return bucket.get(key) ?? null;
  },
  async viewUrl(key) {
    return `https://bucket.example/${key}?signed`;
  },
  async remove(key) {
    bucket.delete(key);
  },
};

async function call(method: string, path: string, as: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-local-user": as },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

async function startRun(as = anna) {
  return (await call("POST", `/guides/${guideId}/runs`, as, { environment: "dev", platform: "ios", device: "iPhone 15", build: "179" })).body.run
    .id as string;
}

/** What the browser does: get a form, "upload" the file, confirm. */
async function attach(runId: string, scenarioKey = "reply-to-comment", size = 200_000, as = anna) {
  const started = await call("POST", `/runs/${runId}/results/${scenarioKey}/attachments`, as, { contentType: "image/jpeg" });
  if (started.status !== 201) return started;
  bucket.set(started.body.upload.fields.key, { size, contentType: "image/jpeg" });
  return call("POST", `/attachments/${started.body.attachment.id}/complete`, as);
}

beforeEach(async () => {
  db = await createTestDb();
  await seedEnvironments(db, defaultEnvironments);
  bucket = new Map();
  app = createApp({ db, authenticate: localAuthenticator, directory: localDirectory, evidenceStorage: fakeStorage });
  await call("POST", "/setup", owner, { teamName: "Acme" });
  const team = (await call("GET", "/me", owner)).body.team;
  for (const tester of [anna, bohdan]) {
    await call("GET", "/me", tester);
    await db.insert(memberships).values({ teamId: team.id, userId: `local:${tester}`, role: "tester" });
  }
  const appId = (await call("POST", "/apps", owner, { slug: "acme-mobile", name: "Acme", platforms: ["ios", "android"] })).body.app.id;
  guideId = (await call("POST", `/apps/${appId}/guides`, owner, { slug: "build-179", content: example })).body.guideId;
});

describe("screenshots as proof", () => {
  it("count as proof for a fail and show in the run, the results and MCP", async () => {
    expect((await call("GET", "/me", anna)).body.features).toEqual({ attachments: true });
    const runId = await startRun();
    expect((await call("PUT", `/runs/${runId}/results/reply-to-comment`, anna, { status: "fail" })).status).toBe(422);

    const done = await attach(runId);
    expect(done.body.attachment).toMatchObject({ contentType: "image/jpeg", size: 200_000, url: expect.stringContaining("?signed") });
    expect((await call("PUT", `/runs/${runId}/results/reply-to-comment`, anna, { status: "fail", note: "Wrong thread" })).status).toBe(200);

    const run = (await call("GET", `/runs/${runId}`, anna)).body;
    expect(run.attachments["reply-to-comment"]).toHaveLength(1);

    const results = (await call("GET", `/guides/${guideId}/results`, owner)).body;
    const cell = results.scenarios
      .find((s: { key: string }) => s.key === "reply-to-comment")
      .cells.find((c: { environment: string; platform: string }) => c.environment === "dev" && c.platform === "ios");
    expect(cell.results[0].attachments).toEqual([expect.objectContaining({ url: expect.stringContaining("?signed") })]);

    // Agents get the same links through get_results.
    const token = (await call("POST", "/agent-tokens", owner, { name: "reader", scope: "read" })).body.token.token;
    const mcp = createMcpHandler({ db, guideLanguage: "en", publicUrl: "https://gp.example.com", evidenceStorage: fakeStorage });
    const response = await mcp(
      new Request("http://guidepass.test/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_results", arguments: { guideId } } }),
      }),
    );
    expect(JSON.stringify(await response.json())).toContain("?signed");
  });

  it("keep unfinished uploads out and refuse a file that isn't what was declared", async () => {
    const runId = await startRun();
    const started = await call("POST", `/runs/${runId}/results/reply-to-comment/attachments`, anna, { contentType: "image/png" });
    // Nothing uploaded yet: not proof, not listed.
    expect((await call("POST", `/attachments/${started.body.attachment.id}/complete`, anna)).body.error.details.reason).toBe("not_uploaded");
    expect((await call("GET", `/runs/${runId}`, anna)).body.attachments).toEqual({});
    // Uploaded as something else: removed.
    bucket.set(started.body.upload.fields.key, { size: 10, contentType: "text/html" });
    expect((await call("POST", `/attachments/${started.body.attachment.id}/complete`, anna)).status).toBe(422);
    expect(bucket.size).toBe(0);
    expect((await call("POST", `/runs/${runId}/results/reply-to-comment/attachments`, anna, { contentType: "image/svg+xml" })).status).toBe(422);
  });

  it("are only for your own open run, up to five per result, and the last proof of a fail stays", async () => {
    const runId = await startRun();
    expect((await call("POST", `/runs/${runId}/results/reply-to-comment/attachments`, bohdan, { contentType: "image/jpeg" })).status).toBe(403);

    const first = await attach(runId);
    await call("PUT", `/runs/${runId}/results/reply-to-comment`, anna, { status: "fail" });
    expect((await call("DELETE", `/attachments/${first.body.attachment.id}`, anna)).body.error.details.reason).toBe("evidence_required");
    expect((await call("DELETE", `/attachments/${first.body.attachment.id}`, bohdan)).status).toBe(403);

    for (let i = 0; i < 4; i++) expect((await attach(runId)).status).toBe(200);
    expect((await attach(runId)).body.error.details.reason).toBe("too_many_files");
    // With other proof left, one can go.
    expect((await call("DELETE", `/attachments/${first.body.attachment.id}`, anna)).status).toBe(200);
    expect(bucket.size).toBe(4);

    await call("PATCH", `/runs/${runId}`, anna, { finished: true });
    expect((await attach(runId)).status).toBe(409);
  });

  it("can't exceed the limit by starting several uploads at once", async () => {
    const runId = await startRun();
    const forms = [];
    for (let i = 0; i < 5; i++) {
      forms.push((await call("POST", `/runs/${runId}/results/reply-to-comment/attachments`, anna, { contentType: "image/jpeg" })).body);
    }
    // Five uploads are already reserved, finished or not.
    expect((await call("POST", `/runs/${runId}/results/reply-to-comment/attachments`, anna, { contentType: "image/jpeg" })).body.error.details.reason).toBe(
      "too_many_files",
    );
    for (const form of forms) bucket.set(form.upload.fields.key, { size: 1000, contentType: "image/jpeg" });
    for (const form of forms) expect((await call("POST", `/attachments/${form.attachment.id}/complete`, anna)).status).toBe(200);
    expect((await call("GET", `/runs/${runId}`, anna)).body.attachments["reply-to-comment"]).toHaveLength(5);
  });

  it("are off when the instance has no bucket", async () => {
    app = createApp({ db, authenticate: localAuthenticator, directory: localDirectory });
    expect((await call("GET", "/me", anna)).body.features).toEqual({ attachments: false });
    const runId = await startRun();
    expect((await call("POST", `/runs/${runId}/results/reply-to-comment/attachments`, anna, { contentType: "image/jpeg" })).status).toBe(404);
  });
});
