import { beforeEach, describe, expect, it } from "vitest";
import example from "@guidepass/schema/examples/build-179.json" with { type: "json" };
import { createApp } from "./app.ts";
import { localAuthenticator } from "./auth.ts";
import { localDirectory } from "./directory.ts";
import { defaultEnvironments, seedEnvironments, type Db } from "./db/client.ts";
import { createLocalDb } from "./db/local.ts";
import { memberships } from "./db/schema.ts";

let db: Db;
let app: ReturnType<typeof createApp>;
let guideId: string;
let appId: string;

const owner = "owner@example.com";
const anna = "anna@example.com";
const bohdan = "bohdan@example.com";

async function call(method: string, path: string, as: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-local-user": as },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

async function startRun(as: string, environment: string, platform: string, device: string) {
  const res = await call("POST", `/guides/${guideId}/runs`, as, { environment, platform, device });
  expect(res.status).toBe(201);
  return res.body.run.id as string;
}

const mark = (as: string, runId: string, key: string, status: string, note?: string) =>
  call("PUT", `/runs/${runId}/results/${key}`, as, { status, note });

beforeEach(async () => {
  db = await createLocalDb();
  await seedEnvironments(db, defaultEnvironments);
  app = createApp({ db, authenticate: localAuthenticator, directory: localDirectory });

  await call("POST", "/setup", owner, { teamName: "Svitlofour" });
  const team = (await call("GET", "/me", owner)).body.team;
  for (const tester of [anna, bohdan]) {
    await call("GET", "/me", tester);
    await db.insert(memberships).values({ teamId: team.id, userId: `local:${tester}`, role: "tester" });
  }
  appId = (await call("POST", "/apps", owner, { slug: "svitlofour-v2", name: "Svitlofour", platforms: ["ios", "android"] }))
    .body.app.id;
  guideId = (await call("POST", `/apps/${appId}/guides`, owner, { slug: "build-179", content: example })).body.guideId;
});

describe("runs", () => {
  it("only starts runs on the guide's environments and the app's platforms", async () => {
    expect((await call("POST", `/guides/${guideId}/runs`, anna, { environment: "prod", platform: "ios", device: "iPhone 15" })).status).toBe(422);
    expect((await call("POST", `/guides/${guideId}/runs`, anna, { environment: "dev", platform: "web", device: "Chrome" })).status).toBe(422);
    const run = await call("POST", `/guides/${guideId}/runs`, anna, { environment: "dev", platform: "ios", device: "iPhone 15" });
    expect(run.body.run).toMatchObject({ version: 1, environmentKey: "dev", platform: "ios" });
  });

  it("marks, clears and counts only scenarios that apply to the run", async () => {
    const runId = await startRun(anna, "dev", "ios", "iPhone 15");
    expect((await mark(anna, runId, "reply-to-comment", "pass")).status).toBe(200);
    expect((await mark(anna, runId, "android-keyboard", "pass")).status).toBe(422);
    expect((await mark(anna, runId, "pull-to-retry", "pass")).status).toBe(422);
    expect((await mark(anna, runId, "missing", "pass")).status).toBe(404);

    let run = await call("GET", `/runs/${runId}`, anna);
    expect(run.body.counts).toEqual({ pass: 1, fail: 0, skip: 0, untested: 0 });

    await mark(anna, runId, "reply-to-comment", "untested");
    run = await call("GET", `/runs/${runId}`, anna);
    expect(run.body.counts).toEqual({ pass: 0, fail: 0, skip: 0, untested: 1 });
  });

  it("keeps people out of each other's runs and freezes finished runs", async () => {
    const runId = await startRun(anna, "dev", "ios", "iPhone 15");
    expect((await mark(bohdan, runId, "reply-to-comment", "fail")).status).toBe(403);
    expect((await call("GET", `/runs/${runId}`, bohdan)).status).toBe(200);

    await call("PATCH", `/runs/${runId}`, anna, { finished: true });
    expect((await mark(anna, runId, "reply-to-comment", "pass")).status).toBe(409);
    await call("PATCH", `/runs/${runId}`, anna, { finished: false });
    expect((await mark(anna, runId, "reply-to-comment", "pass")).status).toBe(200);
  });
});

describe("results", () => {
  it("shows each tester's result and combines them into verdicts", async () => {
    const annaIos = await startRun(anna, "dev", "ios", "iPhone 15");
    const bohdanIos = await startRun(bohdan, "dev", "ios", "iPhone 12");
    const bohdanAndroid = await startRun(bohdan, "dev", "android", "Pixel 8");
    await mark(anna, annaIos, "reply-to-comment", "pass");
    await mark(bohdan, bohdanIos, "reply-to-comment", "fail", "Reply lands under the wrong comment");
    await mark(bohdan, bohdanAndroid, "reply-to-comment", "pass");

    const res = await call("GET", `/guides/${guideId}/results?filter=all`, owner);
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(3);

    const reply = res.body.scenarios.find((s: { key: string }) => s.key === "reply-to-comment");
    const cell = (env: string, platform: string) =>
      reply.cells.find((c: { environment: string; platform: string }) => c.environment === env && c.platform === platform);
    expect(cell("dev", "ios").verdict).toBe("conflict");
    expect(cell("dev", "ios").results.map((r: { device: string; status: string }) => [r.device, r.status])).toEqual([
      ["iPhone 15", "pass"],
      ["iPhone 12", "fail"],
    ]);
    expect(cell("dev", "android").verdict).toBe("pass");
    expect(cell("stg", "ios").verdict).toBe("untested");

    const devIos = res.body.progress.find((p: { environment: string; platform: string }) => p.environment === "dev" && p.platform === "ios");
    expect(devIos.counts).toEqual({ pass: 0, fail: 0, conflict: 1, skip: 0, untested: 0 });
    const stgAndroid = res.body.progress.find((p: { environment: string; platform: string }) => p.environment === "stg" && p.platform === "android");
    expect(stgAndroid.counts.untested).toBe(3);
  });

  it("returns only problems by default and filters by environment, platform and tester", async () => {
    const annaIos = await startRun(anna, "dev", "ios", "iPhone 15");
    await mark(anna, annaIos, "reply-to-comment", "pass");

    // The important scenario is still untested on android and on stg.
    let res = await call("GET", `/guides/${guideId}/results`, owner);
    expect(res.body.scenarios.map((s: { key: string }) => s.key)).toEqual(["reply-to-comment"]);

    res = await call("GET", `/guides/${guideId}/results?environment=dev&platform=ios`, owner);
    expect(res.body.scenarios).toEqual([]);

    res = await call("GET", `/guides/${guideId}/results?filter=all&testerId=local:${bohdan}`, owner);
    expect(res.body.runs).toHaveLength(0);

    expect((await call("GET", `/guides/${guideId}/results?environment=prod`, owner)).status).toBe(422);
  });

  it("carries results over to a new version only for unchanged scenarios", async () => {
    const runId = await startRun(anna, "stg", "android", "Pixel 8");
    await mark(anna, runId, "reply-to-comment", "pass");
    await mark(anna, runId, "android-keyboard", "fail", "Keyboard covers the field");

    const next = structuredClone(example);
    next.scenarios[1]!.expected = "The banner and keyboard leave the field visible.";
    await call("POST", `/apps/${appId}/guides`, owner, {
      slug: "build-179",
      content: next,
      changeNote: "Fix keyboard overlap",
      baseVersion: 1,
    });

    const res = await call("GET", `/guides/${guideId}/results?filter=all&environment=stg&platform=android`, owner);
    expect(res.body.version).toBe(2);
    expect(res.body.runs).toHaveLength(0);
    const byKey = Object.fromEntries(res.body.scenarios.map((s: any) => [s.key, s.cells[0]]));
    expect(byKey["reply-to-comment"]).toMatchObject({ verdict: "pass", results: [{ fromVersion: 1 }] });
    expect(byKey["android-keyboard"]).toMatchObject({ verdict: "untested", results: [] });

    const v1 = await call("GET", `/guides/${guideId}/results?filter=all&version=1&environment=stg&platform=android`, owner);
    expect(v1.body.runs).toHaveLength(1);
  });

  it("shows an older version with that version's environments", async () => {
    const runId = await startRun(anna, "stg", "ios", "iPhone 15");
    await mark(anna, runId, "reply-to-comment", "fail");
    const next = structuredClone(example);
    next.environments = ["dev"];
    next.scenarios.splice(3, 1);
    await call("POST", `/apps/${appId}/guides`, owner, { slug: "build-179", content: next, changeNote: "Dev only", baseVersion: 1 });

    const v1 = await call("GET", `/guides/${guideId}/results?version=1`, owner);
    const reply = v1.body.scenarios.find((s: { key: string }) => s.key === "reply-to-comment");
    expect(reply.cells.find((c: { environment: string; platform: string }) => c.environment === "stg" && c.platform === "ios").verdict).toBe("fail");
    const v2 = await call("GET", `/guides/${guideId}/results?filter=all`, owner);
    expect(v2.body.progress.map((p: { environment: string }) => p.environment)).toEqual(["dev", "dev"]);
  });

  it("keeps the note when only the status changes", async () => {
    const runId = await startRun(anna, "dev", "ios", "iPhone 15");
    await mark(anna, runId, "reply-to-comment", "fail", "Wrong thread");
    await call("PUT", `/runs/${runId}/results/reply-to-comment`, anna, { status: "pass" });
    const run = await call("GET", `/runs/${runId}`, anna);
    expect(run.body.results[0]).toMatchObject({ status: "pass", note: "Wrong thread" });
  });
});

describe("profile", () => {
  it("stores the interface language", async () => {
    expect((await call("GET", "/me", anna)).body.user.locale).toBe("en");
    expect((await call("PATCH", "/me", anna, { locale: "uk", name: "Анна" })).body.user).toMatchObject({ locale: "uk", name: "Анна" });
    expect((await call("GET", "/me", anna)).body.user).toMatchObject({ locale: "uk", name: "Анна" });
    expect((await call("PATCH", "/me", anna, { locale: "de" })).status).toBe(422);
  });
});
