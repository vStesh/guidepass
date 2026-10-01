import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { guideSchema, type GuideContent } from "@guidepass/schema";
import { asc } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { environments } from "../db/schema.ts";
import { ApiError } from "../errors.ts";
import { authenticateAgent, type AgentIdentity } from "../services/agentTokens.ts";
import { MAX_BODY } from "../limits.ts";
import { createArea, getGuideDetail, listAppsWithAreas, listGuides, setGuideStatus } from "../services/catalog.ts";
import { uploadGuide } from "../services/guides.ts";
import { announceGuideUpload, slackNotifier, type Notifier } from "../services/notifications.ts";
import { getGuideResults, loadGuide } from "../services/results.ts";

export interface McpDeps {
  db: Db;
  /** Language guides are written in, returned with the instructions. */
  guideLanguage: string;
  /** Base URL of the web app, for links to guides. */
  publicUrl: string;
  /** Sends Slack messages; defaults to the real webhook call. */
  notifier?: Notifier;
}

const SERVER_INSTRUCTIONS = `Guidepass holds manual test guides for app builds and the results people record on their devices.
Typical loop: list_apps → get_guide_instructions → list_guides (does a guide for this build exist?) → upload_guide with dryRun, fix errors, upload → people test → get_results → fix the code → get_guide → upload_guide with baseVersion and a changeNote.
People test; you never set results. Nothing can be deleted through this server.`;

/**
 * The instructions are a Markdown file in packages/schema. The Lambda bundle
 * carries a copy next to itself; in development it is read from the package.
 */
let instructionsCache: string | undefined;
function guideInstructions(): string {
  if (instructionsCache) return instructionsCache;
  for (const candidate of ["./guide-instructions.md", "../../../packages/schema/guide-instructions.md"]) {
    try {
      instructionsCache = readFileSync(fileURLToPath(new URL(candidate, import.meta.url)), "utf8");
      return instructionsCache;
    } catch {
      // Try the next location.
    }
  }
  throw new Error("guide-instructions.md not found");
}

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

const toolError = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] });

/**
 * Service errors become tool errors the agent can act on. Anything else is logged
 * and reported without details, so SQL, ARNs and parameters never reach the agent.
 */
async function run(fn: () => Promise<unknown>) {
  try {
    return json(await fn());
  } catch (err) {
    if (err instanceof ApiError) {
      const details = err.details === undefined ? "" : `\n${JSON.stringify(err.details, null, 2)}`;
      return toolError(`${err.message}${details}`);
    }
    console.error(err);
    return toolError("Internal error. Try again; if it keeps failing, tell the user.");
  }
}

const versionNumber = z.number().int().min(1).max(2_147_483_647);

function buildServer({ db, guideLanguage, publicUrl, notifier }: McpDeps, agent: AgentIdentity): McpServer {
  const server = new McpServer({ name: "guidepass", version: "0.1.0" }, { instructions: SERVER_INSTRUCTIONS });
  const { teamId } = agent;
  const guideUrl = (id: string) => `${publicUrl}/guides/${id}`;
  const requireWrite = (tool: string) => {
    if (agent.scope !== "write") throw new ApiError("forbidden", `Token has read scope; ${tool} needs write.`);
  };
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  const writes = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  server.registerTool(
    "list_apps",
    {
      description:
        "Apps in the team with their platforms and areas (features). Call this first to find app and area ids. Platform keys are the app's own: built-in ios, android, web, api (backend checked with an HTTP client, logs or the database) and custom ones named in platformNames.",
      annotations: readOnly,
    },
    () => run(async () => ({ apps: await listAppsWithAreas(db, teamId) })),
  );

  server.registerTool(
    "get_guide_instructions",
    {
      description:
        "How to write a guide for this team: instructions (Markdown), the language guides are written in, the environment keys, and the guide JSON Schema. Call before writing or updating a guide.",
      annotations: readOnly,
    },
    () =>
      run(async () => ({
        language: guideLanguage,
        environments: (
          await db
            .select({ key: environments.key, name: environments.name, archived: environments.archived })
            .from(environments)
            .orderBy(asc(environments.position))
        ).filter((e) => !e.archived).map(({ key, name }) => ({ key, name })),
        instructions: guideInstructions(),
        schema: guideSchema,
      })),
  );

  server.registerTool(
    "list_guides",
    {
      description:
        "Guides of an app, newest first, with how many people test the current version and progress per environment and platform (scenario counts by verdict).",
      inputSchema: {
        appId: z.uuid(),
        areaId: z.uuid().optional(),
        status: z.enum(["active", "archived", "all"]).optional().describe("Default: active"),
        build: z.string().optional(),
        environment: z.string().optional(),
        type: z.enum(["feature", "bugfix", "improvement", "mixed"]).optional(),
        // Progress is computed per guide, so keep pages small.
        limit: z.number().int().min(1).max(20).optional().describe("Default and maximum: 20"),
      },
      annotations: readOnly,
    },
    ({ appId, ...filters }) =>
      run(async () => {
        const rows = await listGuides(db, teamId, { ...filters, appId });
        const guides = [];
        for (const row of rows) {
          const { guide, app } = await loadGuide(db, teamId, row.id);
          const results = await getGuideResults(db, guide, app, { filter: "all" });
          guides.push({
            ...row,
            url: guideUrl(row.id),
            testers: new Set(results.runs.map((r) => r.tester.id)).size,
            progress: results.progress,
          });
        }
        return { guides };
      }),
  );

  server.registerTool(
    "get_guide",
    {
      description: "Full content of one guide version (the current one by default) and its version history.",
      inputSchema: { guideId: z.uuid(), version: versionNumber.optional() },
      annotations: readOnly,
    },
    ({ guideId, version }) =>
      run(async () => ({ ...(await getGuideDetail(db, teamId, guideId, version)), url: guideUrl(guideId) })),
  );

  server.registerTool(
    "get_results",
    {
      description:
        "What people found on devices: for every scenario and environment × platform, each tester's result with the build or commit they tested, the app account and role they used, device, note, proof and issue link, plus a combined verdict (pass, fail, conflict = passed for some and failed for others, blocked = couldn't be checked, skip, untested). Only people mark results: a scenario without one is untested, whatever the guide says; `automated` names a test that also covers it but is not a result. By default only problems: fail, conflict, blocked, skip, and key scenarios still untested.",
      inputSchema: {
        guideId: z.uuid(),
        version: versionNumber.optional().describe("Default: current version"),
        environment: z.string().optional(),
        platform: z.string().optional().describe("Platform key from list_apps"),
        testerId: z.string().optional(),
        filter: z.enum(["problems", "all"]).optional().describe("Default: problems"),
      },
      annotations: readOnly,
    },
    ({ guideId, ...options }) =>
      run(async () => {
        const { guide, app } = await loadGuide(db, teamId, guideId);
        return getGuideResults(db, guide, app, options);
      }),
  );

  server.registerTool(
    "create_area",
    {
      description: "Add an area (feature or module) to an app when a guide covers a feature that has no area yet.",
      inputSchema: {
        appId: z.uuid(),
        slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80).describe("Lowercase kebab-case, e.g. comments"),
        name: z.string().min(1).max(100),
      },
      annotations: writes,
    },
    ({ appId, slug, name }) =>
      run(async () => {
        requireWrite("create_area");
        return { area: await createArea(db, teamId, appId, { slug, name }) };
      }),
  );

  server.registerTool(
    "upload_guide",
    {
      description:
        "Create a guide or add a new version. Validate first with dryRun: true. To update an existing guide pass baseVersion (the version you read) and a one-sentence changeNote. Scenario keys that already have results must stay or be marked deprecated. Returns the version and which scenarios were added, changed, deprecated or unchanged — tell the user which need testing again.",
      inputSchema: {
        appId: z.uuid(),
        areaId: z.uuid().nullable().optional(),
        slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80).describe("e.g. build-179"),
        content: z.record(z.string(), z.unknown()).describe("Guide JSON following the schema from get_guide_instructions"),
        changeNote: z.string().max(500).optional(),
        baseVersion: versionNumber.optional(),
        dryRun: z.boolean().optional(),
      },
      annotations: writes,
    },
    (input) =>
      run(async () => {
        requireWrite("upload_guide");
        const author = { userId: agent.userId, tokenId: agent.tokenId };
        const result = await uploadGuide(db, { ...input, teamId, author });
        if (!result.dryRun && result.guideId) {
          await announceGuideUpload(
            { db, notify: notifier ?? slackNotifier, publicUrl, language: guideLanguage },
            {
              appId: input.appId,
              guideId: result.guideId,
              version: result.version,
              content: input.content as unknown as GuideContent,
              changeNote: input.changeNote,
              diff: result.diff,
              author,
            },
          );
        }
        return { ...result, url: result.guideId ? guideUrl(result.guideId) : null };
      }),
  );

  server.registerTool(
    "set_guide_status",
    {
      description: "Archive a guide that no longer matters (released or superseded build), or make an archived one active again.",
      inputSchema: { guideId: z.uuid(), status: z.enum(["active", "archived"]) },
      annotations: { ...writes, idempotentHint: true },
    },
    ({ guideId, status }) =>
      run(async () => {
        requireWrite("set_guide_status");
        return { guide: await setGuideStatus(db, teamId, guideId, status) };
      }),
  );

  return server;
}

/**
 * Remote MCP endpoint (Streamable HTTP, stateless, JSON responses): every request
 * is authenticated with an agent token and served by a fresh server bound to
 * that token's team.
 */
export function createMcpHandler(deps: McpDeps) {
  return async (request: Request): Promise<Response> => {
    const agent = await authenticateAgent(deps.db, request.headers.get("authorization") ?? undefined);
    if (!agent) {
      // No WWW-Authenticate: this server uses static agent tokens, and the header
      // would send clients looking for an OAuth flow that doesn't exist.
      return Response.json(
        { error: { code: "unauthenticated", message: "Send an agent token: Authorization: Bearer gp_…" } },
        { status: 401 },
      );
    }
    // Stateless, JSON-only: no server-to-client stream (GET) or session to end (DELETE).
    // Without this a GET would hold an empty event stream open until Lambda times out.
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    }
    const body = await request.text();
    if (body.length > MAX_BODY) {
      return Response.json({ error: { code: "invalid", message: "Request is too large." } }, { status: 413 });
    }
    const server = buildServer(deps, agent);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(new Request(request.url, { method: "POST", headers: request.headers, body }));
  };
}
