import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import example from "@guidepass/schema/examples/build-179.json" with { type: "json" };
import { createApp } from "./app.ts";
import { localAuthenticator } from "./auth.ts";
import { defaultEnvironments, seedEnvironments, type Db } from "./db/client.ts";
import { createTestDb } from "./db/local.ts";
import { localDirectory } from "./directory.ts";
import { apps, teams, users } from "./db/schema.ts";
import { createMcpHandler } from "./mcp/server.ts";
import { uploadGuide } from "./services/guides.ts";

let db: Db;
let api: ReturnType<typeof createApp>;
let mcp: ReturnType<typeof createMcpHandler>;
let appId: string;
const clients: Client[] = [];

const owner = "owner@example.com";

async function call(method: string, path: string, body?: unknown, as = owner) {
  const response = await api.request(path, {
    method,
    headers: { "content-type": "application/json", "x-local-user": as },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

/** A real MCP client talking to the handler through an in-process fetch. */
async function connect(token: string) {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://guidepass.test/mcp"), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (url, init) => mcp(new Request(url, init)),
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

async function tool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const text = result.content[0]!.text;
  return { isError: !!result.isError, text, data: result.isError ? null : (JSON.parse(text) as any) };
}

async function token(scope: "read" | "write") {
  return (await call("POST", "/agent-tokens", { name: `agent-${scope}`, scope })).body.token.token as string;
}

beforeEach(async () => {
  db = await createTestDb();
  await seedEnvironments(db, defaultEnvironments);
  api = createApp({ db, authenticate: localAuthenticator, directory: localDirectory });
  mcp = createMcpHandler({ db, guideLanguage: "uk", publicUrl: "https://gp.example.com" });
  await call("POST", "/setup", { teamName: "Svitlofour" });
  appId = (await call("POST", "/apps", { slug: "svitlofour-v2", name: "Svitlofour", platforms: ["ios", "android"] })).body.app.id;
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

describe("agent tokens", () => {
  it("are shown once, listed without the secret, and revocable", async () => {
    const created = await call("POST", "/agent-tokens", { name: "Claude on Mac14", scope: "write" });
    expect(created.status).toBe(201);
    expect(created.body.token.token).toMatch(/^gp_/);
    const listed = await call("GET", "/agent-tokens");
    expect(listed.body.tokens).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain(created.body.token.token);

    expect((await call("DELETE", `/agent-tokens/${created.body.token.id}`)).status).toBe(200);
    const response = await mcp(new Request("http://guidepass.test/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${created.body.token.token}`, "content-type": "application/json" },
      body: "{}",
    }));
    expect(response.status).toBe(401);
  });

  it("are held by a member: uploads show as theirs, and removing them revokes the token", async () => {
    const tester = "anna@example.com";
    await call("POST", "/invitations", { email: tester, name: "Anna" });
    await call("GET", "/me", undefined, tester);
    const testerId = `local:${tester}`;

    expect((await call("POST", "/agent-tokens", { name: "x", scope: "write", userId: "local:stranger@example.com" })).status).toBe(422);
    // Given to Anna under the owner's name by mistake: her first upload shows as the owner's.
    const created = await call("POST", "/agent-tokens", { name: "Anna's Claude", scope: "write" });
    const tokenId = created.body.token.id;
    const client = await connect(created.body.token.token);
    const v1 = await tool(client, "upload_guide", { appId, slug: "build-179", content: example });
    const guideId = v1.data.guideId;
    const authors = async () =>
      (await call("GET", `/guides/${guideId}`)).body.versions.map((v: { author: { name: string } }) => v.author.name);
    expect(await authors()).toEqual(["owner@example.com"]);

    // Handing it over changes new uploads only…
    expect((await call("PATCH", `/agent-tokens/${tokenId}`, { userId: testerId })).body.movedUploads).toBe(0);
    expect((await call("GET", "/agent-tokens")).body.tokens[0]).toMatchObject({ userId: testerId, userName: "Anna" });
    const next = structuredClone(example);
    next.scenarios[0]!.expected = "Changed.";
    const v2 = await tool(client, "upload_guide", { appId, slug: "build-179", content: next, baseVersion: 1, changeNote: "x" });
    expect(v2.data.version).toBe(2);
    expect(await authors()).toEqual(["Anna", "owner@example.com"]);
    expect((await call("GET", `/guides/${guideId}`)).body.versions[0].author).toEqual({
      kind: "agent",
      userId: testerId,
      name: "Anna",
      agent: "Anna's Claude",
    });

    // …unless the owner moves the past uploads too (only those of the previous holder).
    await call("PATCH", `/agent-tokens/${tokenId}`, { userId: `local:${owner}` });
    const back = await call("PATCH", `/agent-tokens/${tokenId}`, { userId: testerId, includePastUploads: true });
    expect(back.body.movedUploads).toBe(1);
    expect(await authors()).toEqual(["Anna", "Anna"]);

    // Removing Anna revokes her token.
    await call("DELETE", `/members/${encodeURIComponent(testerId)}`);
    expect((await call("GET", "/agent-tokens")).body.tokens).toHaveLength(0);
    const after = await mcp(new Request("http://guidepass.test/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${created.body.token.token}`, "content-type": "application/json" },
      body: "{}",
    }));
    expect(after.status).toBe(401);
  });

  it("rejects requests without a token", async () => {
    const response = await mcp(new Request("http://guidepass.test/mcp", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
  });
});

describe("MCP tools", () => {
  it("lists the eight tools", async () => {
    const client = await connect(await token("write"));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_area",
      "get_guide",
      "get_guide_instructions",
      "get_results",
      "list_apps",
      "list_guides",
      "set_guide_status",
      "upload_guide",
    ]);
  });

  it("gives the instructions, language, environments and schema", async () => {
    const client = await connect(await token("read"));
    const { data } = await tool(client, "get_guide_instructions");
    expect(data.language).toBe("uk");
    expect(data.environments.map((e: { key: string }) => e.key)).toEqual(["dev", "stg", "prod"]);
    expect(data.instructions).toContain("# How to write a Guidepass test guide");
    expect(data.schema.title).toBe("Guidepass test guide");
  });

  it("runs the whole loop: area, dry run, upload, results, new version", async () => {
    const client = await connect(await token("write"));
    expect((await tool(client, "list_apps")).data.apps[0].id).toBe(appId);

    const area = await tool(client, "create_area", { appId, slug: "comments", name: "Comments" });
    const areaId = area.data.area.id;

    const invalid = await tool(client, "upload_guide", {
      appId,
      slug: "build-179",
      content: { ...example, environments: ["qa"] },
      dryRun: true,
    });
    expect(invalid.isError).toBe(true);
    expect(invalid.text).toContain('unknown environment \\"qa\\"');

    const dry = await tool(client, "upload_guide", { appId, areaId, slug: "build-179", content: example, dryRun: true });
    expect(dry.data).toMatchObject({ dryRun: true, version: 1, url: null });

    const uploaded = await tool(client, "upload_guide", { appId, areaId, slug: "build-179", content: example });
    const guideId = uploaded.data.guideId;
    expect(uploaded.data.url).toBe(`https://gp.example.com/guides/${guideId}`);

    // A person tests; the agent only reads.
    const run = await call("POST", `/guides/${guideId}/runs`, { environment: "dev", platform: "ios", device: "iPhone 15" });
    await call("PUT", `/runs/${run.body.run.id}/results/reply-to-comment`, { status: "fail", note: "Wrong thread" });

    const results = await tool(client, "get_results", { guideId });
    const reply = results.data.scenarios.find((s: { key: string }) => s.key === "reply-to-comment");
    expect(reply.cells.find((c: { environment: string; platform: string }) => c.environment === "dev" && c.platform === "ios"))
      .toMatchObject({ verdict: "fail", results: [{ note: "Wrong thread", device: "iPhone 15" }] });

    const listed = await tool(client, "list_guides", { appId });
    expect(listed.data.guides[0]).toMatchObject({ slug: "build-179", testers: 1 });

    const stale = await tool(client, "upload_guide", { appId, slug: "build-179", content: example, changeNote: "x" });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("pass baseVersion: 1");

    const next = structuredClone(example);
    next.scenarios[0]!.expected = "Reply stays in the thread after scrolling.";
    const v2 = await tool(client, "upload_guide", {
      appId,
      slug: "build-179",
      content: next,
      changeNote: "Fixed reply threading",
      baseVersion: 1,
    });
    expect(v2.data).toMatchObject({ version: 2, diff: { changed: ["reply-to-comment"] } });

    const detail = await tool(client, "get_guide", { guideId });
    expect(detail.data.versions[0]).toMatchObject({ version: 2, changeNote: "Fixed reply threading" });
    expect(detail.data.versions[0].author).toMatchObject({ kind: "agent", agent: expect.any(String) });

    expect((await tool(client, "set_guide_status", { guideId, status: "archived" })).data.guide.status).toBe("archived");
  });

  it("keeps read tokens away from writes", async () => {
    const client = await connect(await token("read"));
    const res = await tool(client, "upload_guide", { appId, slug: "build-179", content: example });
    expect(res.isError).toBe(true);
    expect(res.text).toBe("Token has read scope; upload_guide needs write.");
  });

  it("only sees its own team's data", async () => {
    // A second team with its own app and guide, created directly in the database.
    const [other] = await db.insert(teams).values({ name: "Other" }).returning();
    const [otherApp] = await db.insert(apps).values({ teamId: other!.id, slug: "other", name: "Other", platforms: ["ios", "android"] }).returning();
    await db.insert(users).values({ id: "other-owner", email: "other@example.com" });
    const { guideId: otherGuide } = await uploadGuide(db, {
      teamId: other!.id,
      appId: otherApp!.id,
      slug: "secret",
      content: example,
      author: { userId: "other-owner" },
    });

    const client = await connect(await token("write"));
    expect((await tool(client, "list_apps")).data.apps.map((a: { id: string }) => a.id)).toEqual([appId]);
    expect(await tool(client, "get_guide", { guideId: otherGuide })).toMatchObject({ isError: true, text: "Guide not found." });
    expect(await tool(client, "get_results", { guideId: otherGuide })).toMatchObject({ isError: true, text: "Guide not found." });
    expect((await tool(client, "list_guides", { appId: otherApp!.id })).data.guides).toEqual([]);
    expect(await tool(client, "set_guide_status", { guideId: otherGuide, status: "archived" })).toMatchObject({ isError: true });
    expect(await tool(client, "upload_guide", { appId: otherApp!.id, slug: "x", content: example })).toMatchObject({ isError: true, text: "App not found." });
  });

  it("hides internal errors from the agent", async () => {
    const client = await connect(await token("read"));
    const res = await tool(client, "list_guides", { appId, environment: "dev" });
    expect(res.isError).toBe(false);
    const huge = await client.callTool({ name: "get_guide", arguments: { guideId: appId, version: 99_999_999_999 } });
    expect(huge.isError).toBe(true);
    expect(JSON.stringify(huge)).not.toMatch(/select|Failed query/i);
  });

  it("answers GET and DELETE with 405 instead of holding a stream open", async () => {
    const t = await token("read");
    for (const method of ["GET", "DELETE"]) {
      const response = await mcp(new Request("http://guidepass.test/mcp", { method, headers: { authorization: `Bearer ${t}` } }));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });
});
