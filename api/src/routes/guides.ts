import { validate } from "../validate.ts";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireMembership, type AppEnv } from "../context.ts";
import { apps, guideVersions, guides } from "../db/schema.ts";
import { ApiError } from "../errors.ts";
import { uploadGuide } from "../services/guides.ts";

export const guideRoutes = new Hono<AppEnv>();

const appParam = validate("param", z.object({ appId: z.uuid() }));
const guideParam = validate("param", z.object({ guideId: z.uuid() }));

guideRoutes.get(
  "/apps/:appId/guides",
  appParam,
  validate(
    "query",
    z.object({
      areaId: z.uuid().optional(),
      status: z.enum(["active", "archived", "all"]).default("active"),
      build: z.string().optional(),
      environment: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  ),
  async (c) => {
    const { teamId } = await requireMembership(c);
    const query = c.req.valid("query");
    const filters = [eq(guides.appId, c.req.param("appId")), eq(apps.teamId, teamId)];
    if (query.areaId) filters.push(eq(guides.areaId, query.areaId));
    if (query.status !== "all") filters.push(eq(guides.status, query.status));
    if (query.build) filters.push(eq(guides.build, query.build));
    if (query.environment) {
      filters.push(sql`${guides.environments} @> ${JSON.stringify([query.environment])}::jsonb`);
    }

    const rows = await c.var.db
      .select({
        id: guides.id,
        slug: guides.slug,
        title: guides.title,
        areaId: guides.areaId,
        build: guides.build,
        branch: guides.branch,
        pr: guides.pr,
        environments: guides.environments,
        status: guides.status,
        currentVersion: guides.currentVersion,
        updatedAt: guides.updatedAt,
      })
      .from(guides)
      .innerJoin(apps, eq(apps.id, guides.appId))
      .where(and(...filters))
      .orderBy(desc(guides.updatedAt))
      .limit(query.limit);
    return c.json({ guides: rows });
  },
);

guideRoutes.post(
  "/apps/:appId/guides",
  appParam,
  validate(
    "json",
    z.object({
      slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase kebab-case").max(80),
      areaId: z.uuid().nullable().optional(),
      content: z.unknown(),
      changeNote: z.string().trim().max(500).optional(),
      baseVersion: z.number().int().min(1).optional(),
      dryRun: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const { teamId } = await requireMembership(c, "owner");
    const body = c.req.valid("json");
    const result = await uploadGuide(c.var.db, {
      ...body,
      teamId,
      appId: c.req.param("appId"),
      author: { userId: c.var.user.id },
    });
    return c.json(result, result.dryRun ? 200 : 201);
  },
);

guideRoutes.get(
  "/guides/:guideId",
  guideParam,
  validate("query", z.object({ version: z.coerce.number().int().min(1).optional() })),
  async (c) => {
    const { teamId } = await requireMembership(c);
    const [guide] = await c.var.db
      .select({ guide: guides })
      .from(guides)
      .innerJoin(apps, eq(apps.id, guides.appId))
      .where(and(eq(guides.id, c.req.param("guideId")), eq(apps.teamId, teamId)));
    if (!guide) throw new ApiError("not_found", "Guide not found.");

    const versions = await c.var.db
      .select({
        version: guideVersions.version,
        content: guideVersions.content,
        changeNote: guideVersions.changeNote,
        createdByUserId: guideVersions.createdByUserId,
        createdByTokenId: guideVersions.createdByTokenId,
        createdAt: guideVersions.createdAt,
      })
      .from(guideVersions)
      .where(eq(guideVersions.guideId, guide.guide.id))
      .orderBy(desc(guideVersions.version));

    const wanted = c.req.valid("query").version ?? guide.guide.currentVersion;
    const selected = versions.find((v) => v.version === wanted);
    if (!selected) throw new ApiError("not_found", `Version ${wanted} not found.`);

    return c.json({
      guide: guide.guide,
      version: selected.version,
      content: selected.content,
      versions: versions.map(({ content: _content, ...meta }) => meta),
    });
  },
);

guideRoutes.patch(
  "/guides/:guideId",
  guideParam,
  validate("json", z.object({ status: z.enum(["active", "archived"]) })),
  async (c) => {
    const { teamId } = await requireMembership(c, "owner");
    const [found] = await c.var.db
      .select({ id: guides.id })
      .from(guides)
      .innerJoin(apps, eq(apps.id, guides.appId))
      .where(and(eq(guides.id, c.req.param("guideId")), eq(apps.teamId, teamId)));
    if (!found) throw new ApiError("not_found", "Guide not found.");
    const [updated] = await c.var.db
      .update(guides)
      .set({ status: c.req.valid("json").status, updatedAt: new Date() })
      .where(eq(guides.id, found.id))
      .returning();
    return c.json({ guide: updated });
  },
);
