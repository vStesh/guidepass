import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createApp } from "./app.ts";
import { localAuthenticator } from "./auth.ts";
import { localDirectory } from "./directory.ts";
import { defaultEnvironments, seedEnvironments } from "./db/client.ts";
import { createLocalDb } from "./db/local.ts";
import { localEvidenceStorage } from "./local-storage.ts";
import { createMcpHandler } from "./mcp/server.ts";
import type { Updater } from "./updater.ts";

// Local development server: data in api/.data (or GUIDEPASS_DATA_DIR, e.g. a fresh
// folder for browser tests), sign in by sending `x-local-user: you@example.com`.
const dataDir = process.env.GUIDEPASS_DATA_DIR || new URL("../.data", import.meta.url).pathname;
const db = await createLocalDb(dataDir);
await seedEnvironments(db, defaultEnvironments);

const port = Number(process.env.PORT ?? 8787);
// Screenshots go to api/.data/evidence, served by this server.
const evidence = localEvidenceStorage(`${dataDir}/evidence`);
const mcp = createMcpHandler({
  db,
  guideLanguage: process.env.GUIDE_LANGUAGE ?? "en",
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:5173",
  evidenceStorage: evidence.storage,
});
// GUIDEPASS_DEMO_UPDATER=1 shows the Update button with a pretend update (about 30 s),
// to work on the web app without AWS. Nothing is deployed.
const demoUpdates = new Map<string, number>();
const demoUpdater: Updater = {
  async start() {
    // version and commit are ignored: nothing is deployed.
    const id = `demo-${demoUpdates.size + 1}`;
    demoUpdates.set(id, Date.now());
    return { id };
  },
  async get(id) {
    const started = demoUpdates.get(id);
    if (!started) return null;
    const seconds = (Date.now() - started) / 1000;
    const phase = seconds < 5 ? "INSTALL" : seconds < 15 ? "PRE_BUILD" : seconds < 30 ? "BUILD" : "COMPLETED";
    const log = ["Installing Terraform", "Snapshot of the database before updating", "terraform apply", "Updated"].slice(0, Math.min(4, 1 + Math.floor(seconds / 8)));
    return { status: seconds < 30 ? "running" : "succeeded", phase, startedAt: new Date(started).toISOString(), endedAt: null, log };
  },
};

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
      updater: process.env.GUIDEPASS_DEMO_UPDATER ? demoUpdater : null,
    }),
  )
  .all("/mcp", (c) => mcp(c.req.raw));
// Local auth trusts a header, so only this machine may reach it.
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`Guidepass API on http://localhost:${port}/api, MCP on http://localhost:${port}/mcp`);
