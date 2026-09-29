import { validate } from "../validate.ts";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireMembership, type AppEnv } from "../context.ts";
import { apps, areas } from "../db/schema.ts";
import { ApiError, isUniqueViolation } from "../errors.ts";

export const appRoutes = new Hono<AppEnv>();

const appParam = validate("param", z.object({ appId: z.uuid() }));

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase kebab-case").max(80);

appRoutes.get("/apps", async (c) => {
  const { teamId } = await requireMembership(c);
  const rows = await c.var.db.select().from(apps).where(eq(apps.teamId, teamId)).orderBy(asc(apps.name));
  return c.json({ apps: rows });
});

appRoutes.post(
  "/apps",
  validate(
    "json",
    z.object({
      slug,
      name: z.string().trim().min(1).max(100),
      platforms: z.array(z.enum(["ios", "android", "web"])).min(1),
    }),
  ),
  async (c) => {
    const { teamId } = await requireMembership(c, "owner");
    const body = c.req.valid("json");
    try {
      const [created] = await c.var.db
        .insert(apps)
        .values({ ...body, platforms: [...new Set(body.platforms)], teamId })
        .returning();
      return c.json({ app: created }, 201);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiError("conflict", `App ${body.slug} already exists.`);
      throw err;
    }
  },
);

appRoutes.get("/apps/:appId", appParam, async (c) => {
  const { teamId } = await requireMembership(c);
  const [app] = await c.var.db
    .select()
    .from(apps)
    .where(and(eq(apps.id, c.req.param("appId")), eq(apps.teamId, teamId)));
  if (!app) throw new ApiError("not_found", "App not found.");
  const appAreas = await c.var.db.select().from(areas).where(eq(areas.appId, app.id)).orderBy(asc(areas.name));
  return c.json({ app: { ...app, areas: appAreas } });
});

appRoutes.post(
  "/apps/:appId/areas",
  appParam,
  validate("json", z.object({ slug, name: z.string().trim().min(1).max(100) })),
  async (c) => {
    const { teamId } = await requireMembership(c, "owner");
    const [app] = await c.var.db
      .select({ id: apps.id })
      .from(apps)
      .where(and(eq(apps.id, c.req.param("appId")), eq(apps.teamId, teamId)));
    if (!app) throw new ApiError("not_found", "App not found.");
    const body = c.req.valid("json");
    try {
      const [created] = await c.var.db.insert(areas).values({ ...body, appId: app.id }).returning();
      return c.json({ area: created }, 201);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiError("conflict", `Area ${body.slug} already exists in this app.`);
      throw err;
    }
  },
);
