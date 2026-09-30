import { validate } from "../validate.ts";
import { Hono } from "hono";
import { z } from "zod";
import { requireMembership, type AppEnv } from "../context.ts";
import { getGuideDetail, listGuides, setGuideStatus } from "../services/catalog.ts";
import type { GuideContent } from "@guidepass/schema";
import { uploadGuide } from "../services/guides.ts";
import { announceGuideUpload } from "../services/notifications.ts";

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
      type: z.enum(["feature", "bugfix", "improvement", "mixed"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  ),
  async (c) => {
    const { teamId } = await requireMembership(c);
    return c.json({ guides: await listGuides(c.var.db, teamId, c.req.valid("param").appId, c.req.valid("query")) });
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
      baseVersion: z.number().int().min(1).max(2_147_483_647).optional(),
      dryRun: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const { teamId } = await requireMembership(c, "owner");
    const body = c.req.valid("json");
    const appId = c.req.valid("param").appId;
    const author = { userId: c.var.user.id };
    const result = await uploadGuide(c.var.db, { ...body, teamId, appId, author });
    if (!result.dryRun && result.guideId) {
      await announceGuideUpload(c.var.notifications, {
        appId,
        guideId: result.guideId,
        version: result.version,
        content: body.content as GuideContent,
        changeNote: body.changeNote,
        diff: result.diff,
        author,
      });
    }
    return c.json(result, result.dryRun ? 200 : 201);
  },
);

guideRoutes.get(
  "/guides/:guideId",
  guideParam,
  validate("query", z.object({ version: z.coerce.number().int().min(1).max(2_147_483_647).optional() })),
  async (c) => {
    const { teamId } = await requireMembership(c);
    return c.json(await getGuideDetail(c.var.db, teamId, c.req.valid("param").guideId, c.req.valid("query").version));
  },
);

guideRoutes.patch(
  "/guides/:guideId",
  guideParam,
  validate("json", z.object({ status: z.enum(["active", "archived"]) })),
  async (c) => {
    const { teamId } = await requireMembership(c, "owner");
    const guide = await setGuideStatus(c.var.db, teamId, c.req.valid("param").guideId, c.req.valid("json").status);
    return c.json({ guide });
  },
);
