import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createApp } from "./app.ts";
import { localAuthenticator } from "./auth.ts";
import { localDirectory } from "./directory.ts";
import { defaultEnvironments, seedEnvironments } from "./db/client.ts";
import { createLocalDb } from "./db/local.ts";

// Local development server: data in api/.data, sign in by sending `x-local-user: you@example.com`.
const db = await createLocalDb(new URL("../.data", import.meta.url).pathname);
await seedEnvironments(db, defaultEnvironments);

const port = Number(process.env.PORT ?? 8787);
const app = new Hono().route("/api", createApp({ db, authenticate: localAuthenticator, directory: localDirectory }));
serve({ fetch: app.fetch, port });
console.log(`Guidepass API on http://localhost:${port}/api`);
