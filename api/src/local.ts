import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createApp } from "./app.ts";
import { localAuthenticator } from "./auth.ts";
import { localDirectory } from "./directory.ts";
import { defaultEnvironments, seedEnvironments } from "./db/client.ts";
import { createLocalDb } from "./db/local.ts";
import { localEvidenceStorage } from "./local-storage.ts";
import { createMcpHandler } from "./mcp/server.ts";

// Local development server: data in api/.data, sign in by sending `x-local-user: you@example.com`.
const db = await createLocalDb(new URL("../.data", import.meta.url).pathname);
await seedEnvironments(db, defaultEnvironments);

const port = Number(process.env.PORT ?? 8787);
// Screenshots go to api/.data/evidence, served by this server.
const evidence = localEvidenceStorage(new URL("../.data/evidence", import.meta.url).pathname);
const mcp = createMcpHandler({
  db,
  guideLanguage: process.env.GUIDE_LANGUAGE ?? "en",
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:5173",
  evidenceStorage: evidence.storage,
});
const app = new Hono()
  // Before the API: like S3, the signed form is the only permission an upload needs.
  .route("/api", evidence.routes)
  .route(
    "/api",
    createApp({
      db,
      authenticate: localAuthenticator,
      directory: localDirectory,
      publicUrl: process.env.PUBLIC_URL ?? "http://localhost:5173",
      guideLanguage: process.env.GUIDE_LANGUAGE ?? "en",
      // Off unless set, so local development doesn't call GitHub.
      updateRepository: process.env.UPDATE_REPOSITORY || null,
      evidenceStorage: evidence.storage,
    }),
  )
  .all("/mcp", (c) => mcp(c.req.raw));
// Local auth trusts a header, so only this machine may reach it.
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`Guidepass API on http://localhost:${port}/api, MCP on http://localhost:${port}/mcp`);
