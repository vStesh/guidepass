import { beforeEach, describe, expect, it } from "vitest";
import example from "@guidepass/schema/examples/build-179.json" with { type: "json" };
import { createApp } from "./app.ts";
import { localAuthenticator } from "./auth.ts";
import { defaultEnvironments, seedEnvironments, type Db } from "./db/client.ts";
import { createTestDb } from "./db/local.ts";
import type { UserDirectory } from "./directory.ts";

let db: Db;
let app: ReturnType<typeof createApp>;
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

const activityOf = async (as: string) => (await call("GET", "/guides", as)).body.guides[0].activity;
/** The guide page's progress, summed over environments and platforms. */
async function pageCounts(as: string) {
  const { progress } = (await call("GET", `/guides/${guideId}/results`, as)).body;
  const sum: Record<string, number> = {};
  for (const { counts } of progress) for (const [k, v] of Object.entries(counts as Record<string, number>)) sum[k] = (sum[k] ?? 0) + v;
  return sum;
}
const startRun = async (as: string) =>
  (await call("POST", `/guides/${guideId}/runs`, as, { environment: "dev", platform: "ios", device: "iPhone 15", build: "179" })).body.run.id as string;

beforeEach(async () => {
  db = await createTestDb();
  await seedEnvironments(db, defaultEnvironments);
  app = createApp({ db, authenticate: localAuthenticator, directory });
  await call("POST", "/setup", owner, { teamName: "Acme" });
  await call("POST", "/invitations", owner, { email: anna });
  await call("GET", "/me", anna);
  appId = (await call("POST", "/apps", owner, { slug: "acme-mobile", name: "Acme mobile", platforms: ["ios", "android"] })).body.app.id;
  guideId = (await call("POST", `/apps/${appId}/guides`, owner, { slug: "build-179", content: example })).body.guideId;
});

describe("guide activity in the lists", () => {
  it("starts untested, then follows runs, results and who is testing", async () => {
    // Over dev/stg × iOS/Android: 3 active scenarios, two of them limited to Android or stg.
    expect(await activityOf(anna)).toEqual({
      counts: { pass: 0, fail: 0, conflict: 0, blocked: 0, skip: 0, untested: 8 },
      testers: 0,
      runs: 0,
      openRuns: 0,
      lastActivityAt: null,
      mine: "none",
      carriedOver: false,
    });

    const annaRun = await startRun(anna);
    expect(await activityOf(anna)).toMatchObject({ testers: 1, runs: 1, openRuns: 1, mine: "open" });
    expect((await activityOf(owner)).mine).toBe("none");
    expect((await activityOf(owner)).lastActivityAt).toEqual(expect.any(String));

    await call("PUT", `/runs/${annaRun}/results/reply-to-comment`, anna, { status: "pass" });
    expect((await activityOf(anna)).counts).toMatchObject({ pass: 1, untested: 7 });

    // A pass and a fail on the same scenario, environment and platform are a conflict.
    const ownerRun = await startRun(owner);
    await call("PUT", `/runs/${ownerRun}/results/reply-to-comment`, owner, { status: "fail", note: "Crashes", evidence: "Stack trace" });
    await call("PATCH", `/runs/${annaRun}`, anna, { finished: true });
    expect(await activityOf(anna)).toMatchObject({
      counts: { pass: 0, conflict: 1, untested: 7 },
      testers: 2,
      runs: 2,
      openRuns: 1,
      mine: "finished",
    });
    // The card says the same as the guide's page.
    expect((await activityOf(anna)).counts).toEqual(await pageCounts(anna));
  });

  it("counts results from an older version while the scenario is unchanged", async () => {
    const run = await startRun(anna);
    await call("PUT", `/runs/${run}/results/reply-to-comment`, anna, { status: "pass" });
    await call("POST", `/apps/${appId}/guides`, owner, {
      slug: "build-179",
      content: { ...example, title: "Build 179, retitled" },
      baseVersion: 1,
      changeNote: "New title",
    });
    expect(await activityOf(anna)).toMatchObject({
      counts: { pass: 1, untested: 7 },
      testers: 1,
      runs: 0,
      mine: "none",
      carriedOver: true,
    });
    expect((await activityOf(anna)).counts).toEqual(await pageCounts(anna));
  });
});
