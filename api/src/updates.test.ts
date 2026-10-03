import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { localAuthenticator } from "./auth.ts";
import { defaultEnvironments, seedEnvironments, type Db } from "./db/client.ts";
import { createTestDb } from "./db/local.ts";
import { localDirectory } from "./directory.ts";
import { memberships } from "./db/schema.ts";
import { compareVersions, VERSION } from "./version.ts";

let db: Db;
let calls: string[];
let answer: () => Response;

const owner = "owner@example.com";
const tester = "tester@example.com";

const fakeGitHub: typeof fetch = async (input) => {
  calls.push(String(input));
  return answer();
};

const release = (tag: string) =>
  Response.json({
    tag_name: tag,
    name: `Guidepass ${tag}`,
    body: "### Added\n- Update banner",
    html_url: `https://github.com/acme/guidepass/releases/tag/${tag}`,
    published_at: "2026-10-03T10:00:00Z",
  });

function app(repository: string | null = "acme/guidepass") {
  return createApp({ db, authenticate: localAuthenticator, directory: localDirectory, updateRepository: repository, updateFetch: fakeGitHub });
}

async function call(path: string, as = owner, repository?: string | null) {
  const response = await app(repository).request(path, { headers: { "x-local-user": as } });
  return { status: response.status, body: (await response.json()) as any };
}

beforeEach(async () => {
  db = await createTestDb();
  await seedEnvironments(db, defaultEnvironments);
  calls = [];
  answer = () => release("v99.0.0");
  await app().request("/setup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-local-user": owner },
    body: JSON.stringify({ teamName: "Acme" }),
  });
  const team = (await call("/me")).body.team;
  await call("/me", tester);
  await db.insert(memberships).values({ teamId: team.id, userId: `local:${tester}`, role: "tester" });
});

describe("update check", () => {
  it("tells owners about a newer release and caches the answer for a day", async () => {
    const first = await call("/updates");
    expect(first.body).toMatchObject({
      current: VERSION,
      enabled: true,
      updateAvailable: true,
      latest: { version: "99.0.0", name: "Guidepass v99.0.0", notes: "### Added\n- Update banner" },
    });
    expect(calls).toEqual(["https://api.github.com/repos/acme/guidepass/releases/latest"]);

    await call("/updates");
    expect(calls).toHaveLength(1);
    await call("/updates?refresh=1");
    expect(calls).toHaveLength(2);
  });

  it("is quiet when this version is the newest, there are no releases, or GitHub is down", async () => {
    answer = () => release(`v${VERSION}`);
    expect((await call("/updates")).body.updateAvailable).toBe(false);

    answer = () => new Response("{}", { status: 404 });
    expect((await call("/updates?refresh=1")).body).toMatchObject({ updateAvailable: false, latest: null });

    // A failed check keeps the last answer.
    answer = () => release("v99.0.0");
    await call("/updates?refresh=1");
    answer = () => new Response("oops", { status: 500 });
    expect((await call("/updates?refresh=1")).body).toMatchObject({ updateAvailable: true, latest: { version: "99.0.0" } });
  });

  it("can be turned off, and is for owners only", async () => {
    const off = await call("/updates", owner, null);
    expect(off.body).toEqual({ current: VERSION, enabled: false, latest: null, updateAvailable: false, checkedAt: null });
    expect(calls).toHaveLength(0);
    expect((await call("/updates", tester)).status).toBe(403);
    expect((await call("/version", tester)).body).toEqual({ version: VERSION });
  });
});

describe("compareVersions", () => {
  it("orders releases and pre-releases", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
  });
});
