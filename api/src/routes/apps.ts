import { validate } from "../validate.ts";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireMembership, type AppEnv } from "../context.ts";
import { builtInPlatforms } from "@guidepass/schema/core";
import { apps, guideVersions, guides, runs, slackEvents, type SlackEvent } from "../db/schema.ts";
import { isSlackWebhook, publicApp, sendTestNotification } from "../services/notifications.ts";
import { createArea, getApp } from "../services/catalog.ts";
import { ApiError, isUniqueViolation } from "../errors.ts";

export const appRoutes = new Hono<AppEnv>();

const appParam = validate("param", z.object({ appId: z.uuid() }));

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase kebab-case").max(80);
const platformKey = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase kebab-case").max(30);
const platformNames = z.record(platformKey, z.string().trim().min(1).max(40));

const isBuiltIn = (p: string) => (builtInPlatforms as readonly string[]).includes(p);

/**
 * The app's own platforms (anything not built in) need a display name. Returns
 * only those names, so built-in and removed platforms don't leave stale entries.
 */
function ownPlatformNames(platforms: string[], names: Record<string, string>): Record<string, string> {
  const own = platforms.filter((p) => !isBuiltIn(p));
  const missing = own.filter((p) => !names[p]);
  if (missing.length) {
    throw new ApiError("invalid", `Give a name to the app's own platforms: ${missing.join(", ")}.`, { platforms: missing });
  }
  return Object.fromEntries(own.map((p) => [p, names[p]!]));
}

appRoutes.get("/apps", async (c) => {
  const { teamId } = await requireMembership(c);
  const rows = await c.var.db.select().from(apps).where(eq(apps.teamId, teamId)).orderBy(asc(apps.name));
  return c.json({ apps: rows.map(publicApp) });
});

appRoutes.post(
  "/apps",
  validate(
    "json",
    z.object({
      slug,
      name: z.string().trim().min(1).max(100),
      platforms: z.array(platformKey).min(1).max(12),
      platformNames: platformNames.optional(),
    }),
  ),
  async (c) => {
    const { teamId } = await requireMembership(c, "owner");
    const body = c.req.valid("json");
    const platforms = [...new Set(body.platforms)];
    const names = ownPlatformNames(platforms, body.platformNames ?? {});
    try {
      const [created] = await c.var.db
        .insert(apps)
        .values({ ...body, platforms, platformNames: names, teamId })
        .returning();
      return c.json({ app: publicApp(created!) }, 201);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiError("conflict", `App ${body.slug} already exists.`);
      throw err;
    }
  },
);

appRoutes.get("/apps/:appId", appParam, async (c) => {
  const { teamId } = await requireMembership(c);
  return c.json({ app: publicApp(await getApp(c.var.db, teamId, c.req.valid("param").appId)) });
});

/** Rename an app or change its platforms. A platform that already has runs can't be removed. */
appRoutes.patch(
  "/apps/:appId",
  appParam,
  validate(
    "json",
    z.object({
      name: z.string().trim().min(1).max(100).optional(),
      platforms: z.array(platformKey).min(1).max(12).optional(),
      platformNames: platformNames.optional(),
      slack: z
        .object({
          // null removes the webhook.
          webhookUrl: z.string().trim().max(500).refine(isSlackWebhook, "must be a Slack Incoming Webhook URL (https://hooks.slack.com/services/…)").nullable().optional(),
          events: z.array(z.enum(slackEvents as [SlackEvent, ...SlackEvent[]])).optional(),
        })
        .optional(),
    }),
  ),
  async (c) => {
    const { teamId } = await requireMembership(c, "owner");
    const app = await getApp(c.var.db, teamId, c.req.valid("param").appId);
    const body = c.req.valid("json");
    const platforms = body.platforms ? [...new Set(body.platforms)] : app.platforms;
    const names = ownPlatformNames(platforms, { ...app.platformNames, ...body.platformNames });

    const removed = app.platforms.filter((p) => !platforms.includes(p));
    if (removed.length) {
      const used = await c.var.db
        .selectDistinct({ platform: runs.platform })
        .from(runs)
        .innerJoin(guideVersions, eq(guideVersions.id, runs.guideVersionId))
        .innerJoin(guides, eq(guides.id, guideVersions.guideId))
        .where(and(eq(guides.appId, app.id), inArray(runs.platform, removed)));
      if (used.length) {
        const keys = used.map((u) => u.platform);
        throw new ApiError("conflict", `Platforms with test runs can't be removed: ${keys.join(", ")}.`, { platforms: keys });
      }

      // Scenarios of active guides that name a removed platform would silently drop out of testing.
      const current = await c.var.db
        .select({ slug: guides.slug, content: guideVersions.content })
        .from(guides)
        .innerJoin(
          guideVersions,
          and(eq(guideVersions.guideId, guides.id), eq(guideVersions.version, guides.currentVersion)),
        )
        .where(and(eq(guides.appId, app.id), eq(guides.status, "active")));
      const inGuides = current.filter(({ content }) =>
        content.scenarios.some((s) => s.platforms?.some((p) => removed.includes(p))),
      );
      if (inGuides.length) {
        const slugs = inGuides.map((g) => g.slug);
        throw new ApiError(
          "conflict",
          `Active guides have scenarios on these platforms: ${slugs.join(", ")}. Update or archive them first.`,
          { guides: slugs },
        );
      }
    }

    const slack = body.slack
      ? {
          ...(body.slack.webhookUrl !== undefined ? { slackWebhookUrl: body.slack.webhookUrl } : {}),
          ...(body.slack.events ? { slackEvents: [...new Set(body.slack.events)] } : {}),
        }
      : {};
    const [updated] = await c.var.db
      .update(apps)
      .set({ name: body.name ?? app.name, platforms, platformNames: names, ...slack })
      .where(eq(apps.id, app.id))
      .returning();
    return c.json({ app: publicApp(updated!) });
  },
);

/** Owner check that the webhook works; reports Slack's answer instead of hiding it. */
appRoutes.post("/apps/:appId/slack/test", appParam, async (c) => {
  const { teamId } = await requireMembership(c, "owner");
  const app = await getApp(c.var.db, teamId, c.req.valid("param").appId);
  try {
    if (!(await sendTestNotification(c.var.notifications, app))) {
      throw new ApiError("invalid", "This app has no Slack webhook yet.");
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("invalid", `Slack didn't accept the message: ${(err as Error).message}`);
  }
  return c.json({ sent: true });
});

appRoutes.post(
  "/apps/:appId/areas",
  appParam,
  validate("json", z.object({ slug, name: z.string().trim().min(1).max(100) })),
  async (c) => {
    const { teamId } = await requireMembership(c, "owner");
    const area = await createArea(c.var.db, teamId, c.req.valid("param").appId, c.req.valid("json"));
    return c.json({ area }, 201);
  },
);
