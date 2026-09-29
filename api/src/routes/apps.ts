import { validate } from "../validate.ts";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireMembership, type AppEnv } from "../context.ts";
import { apps } from "../db/schema.ts";
import { createArea, getApp } from "../services/catalog.ts";
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
  return c.json({ app: await getApp(c.var.db, teamId, c.req.valid("param").appId) });
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
