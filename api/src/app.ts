import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { MAX_BODY } from "./limits.ts";
import type { EvidenceStorage } from "./storage.ts";
import type { Updater } from "./updater.ts";
import type { Authenticator } from "./auth.ts";
import type { AppEnv } from "./context.ts";
import type { Db } from "./db/client.ts";
import type { UserDirectory } from "./directory.ts";
import { slackNotifier, type Notifier } from "./services/notifications.ts";
import { users, type Locale } from "./db/schema.ts";
import { ApiError } from "./errors.ts";
import { agentTokenRoutes } from "./routes/agentTokens.ts";
import { updateRoutes } from "./routes/updates.ts";
import { appRoutes } from "./routes/apps.ts";
import { guideRoutes } from "./routes/guides.ts";
import { memberRoutes } from "./routes/members.ts";
import { runRoutes } from "./routes/runs.ts";
import { teamRoutes } from "./routes/team.ts";

export interface AppDeps {
  db: Db;
  authenticate: Authenticator;
  directory: UserDirectory;
  ownerEmail?: string;
  /** Sends Slack messages; defaults to the real webhook call. */
  notifier?: Notifier;
  /** Base URL of the web app, for links in notifications. */
  publicUrl?: string;
  /** Instance guide language, also used for notifications. */
  guideLanguage?: string;
  /** GitHub `owner/repo` whose releases owners are told about; null turns the check off. */
  updateRepository?: string | null;
  /** For tests: how GitHub is reached. */
  updateFetch?: typeof fetch;
  /** Where screenshots attached as proof are kept; null turns attachments off. */
  evidenceStorage?: EvidenceStorage | null;
  /** Runs the Update button's updates; null when the instance has no updater (self_update off). */
  updater?: Updater | null;
}

/** `uk` when the browser prefers Ukrainian, otherwise English. */
export function preferredLocale(acceptLanguage: string | undefined): Locale {
  const first = acceptLanguage?.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("uk") ? "uk" : "en";
}

export function createApp({
  db,
  authenticate,
  directory,
  ownerEmail,
  notifier = slackNotifier,
  publicUrl = "http://localhost:5173",
  guideLanguage = "en",
  updateRepository = null,
  updateFetch,
  evidenceStorage = null,
  updater = null,
}: AppDeps) {
  const notifications = { db, notify: notifier, publicUrl, language: guideLanguage };
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
    }
    console.error(err);
    return c.json({ error: { code: "internal", message: "Something went wrong." } }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true }));

  // Guides are a few kilobytes; much larger content would break reads through the Data API (1 MB per response).
  app.use("*", bodyLimit({ maxSize: MAX_BODY, onError: (c) => c.json({ error: { code: "invalid", message: "Request is too large." } }, 413) }));

  app.use("*", async (c, next) => {
    const identity = await authenticate(c.req.raw);
    if (!identity) throw new ApiError("unauthenticated", "Sign in to continue.");

    const [user] = await db
      .insert(users)
      .values({
        id: identity.sub,
        email: identity.email,
        name: identity.name ?? null,
        // A new profile starts in the browser's language; later it's the person's choice (PATCH /me).
        locale: preferredLocale(c.req.header("accept-language")),
      })
      .onConflictDoUpdate({
        target: users.id,
        // Cognito fills the name once; after that it is the person's Guidepass name (PATCH /me).
        set: { email: identity.email, name: sql`coalesce(${users.name}, excluded.name)` },
      })
      .returning({ id: users.id, email: users.email, name: users.name, locale: users.locale });

    c.set("db", db);
    c.set("ownerEmail", ownerEmail);
    c.set("directory", directory);
    c.set("updates", { repository: updateRepository, fetch: updateFetch, updater });
    c.set("evidence", evidenceStorage);
    c.set("notifications", notifications);
    c.set("user", user!);
    await next();
  });

  app.route("/", teamRoutes);
  app.route("/", appRoutes);
  app.route("/", guideRoutes);
  app.route("/", runRoutes);
  app.route("/", memberRoutes);
  app.route("/", agentTokenRoutes);
  app.route("/", updateRoutes);

  return app;
}
