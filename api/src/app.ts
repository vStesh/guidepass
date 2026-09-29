import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Authenticator } from "./auth.ts";
import type { AppEnv } from "./context.ts";
import type { Db } from "./db/client.ts";
import type { UserDirectory } from "./directory.ts";
import { users } from "./db/schema.ts";
import { ApiError } from "./errors.ts";
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
}

export function createApp({ db, authenticate, directory, ownerEmail }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
    }
    console.error(err);
    return c.json({ error: { code: "internal", message: "Something went wrong." } }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true }));

  app.use("*", async (c, next) => {
    const identity = await authenticate(c.req.raw);
    if (!identity) throw new ApiError("unauthenticated", "Sign in to continue.");

    const [user] = await db
      .insert(users)
      .values({ id: identity.sub, email: identity.email, name: identity.name ?? null })
      .onConflictDoUpdate({
        target: users.id,
        // Cognito fills the name once; after that it is the person's Guidepass name (PATCH /me).
        set: { email: identity.email, name: sql`coalesce(${users.name}, excluded.name)` },
      })
      .returning({ id: users.id, email: users.email, name: users.name, locale: users.locale });

    c.set("db", db);
    c.set("ownerEmail", ownerEmail);
    c.set("directory", directory);
    c.set("user", user!);
    await next();
  });

  app.route("/", teamRoutes);
  app.route("/", appRoutes);
  app.route("/", guideRoutes);
  app.route("/", runRoutes);
  app.route("/", memberRoutes);

  return app;
}
