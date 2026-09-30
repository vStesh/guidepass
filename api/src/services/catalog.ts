import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { GuideType } from "@guidepass/schema";
import type { Db } from "../db/client.ts";
import { apps, areas, guideVersions, guides, type GuideStatus } from "../db/schema.ts";
import { ApiError, isUniqueViolation } from "../errors.ts";
import { publicApp } from "./notifications.ts";

// Reads and writes shared by the web API and the MCP server. Every function is
// scoped to one team.

export async function getApp(db: Db, teamId: string, appId: string) {
  const [app] = await db
    .select()
    .from(apps)
    .where(and(eq(apps.id, appId), eq(apps.teamId, teamId)));
  if (!app) throw new ApiError("not_found", "App not found.");
  const appAreas = await db.select().from(areas).where(eq(areas.appId, app.id)).orderBy(asc(areas.name));
  return { ...app, areas: appAreas };
}

/** Apps with their areas and how many active guides each area has. */
export async function listAppsWithAreas(db: Db, teamId: string) {
  const appRows = await db.select().from(apps).where(eq(apps.teamId, teamId)).orderBy(asc(apps.name));
  const areaRows = await db
    .select({ area: areas, activeGuides: count(guides.id) })
    .from(areas)
    .innerJoin(apps, eq(apps.id, areas.appId))
    .leftJoin(guides, and(eq(guides.areaId, areas.id), eq(guides.status, "active")))
    .where(eq(apps.teamId, teamId))
    .groupBy(areas.id)
    .orderBy(asc(areas.name));
  return appRows.map((app) => ({
    ...publicApp(app),
    areas: areaRows
      .filter((row) => row.area.appId === app.id)
      .map((row) => ({ id: row.area.id, slug: row.area.slug, name: row.area.name, activeGuides: row.activeGuides })),
  }));
}

export async function createArea(db: Db, teamId: string, appId: string, body: { slug: string; name: string }) {
  const app = await getApp(db, teamId, appId);
  try {
    const [created] = await db.insert(areas).values({ ...body, appId: app.id }).returning();
    return created!;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = app.areas.find((a) => a.slug === body.slug);
      throw new ApiError("conflict", `Area ${body.slug} already exists in this app.`, { area: existing });
    }
    throw err;
  }
}

export interface GuideFilters {
  /** One app, or every app of the team when left out. */
  appId?: string;
  areaId?: string;
  status?: GuideStatus | "all";
  build?: string;
  environment?: string;
  type?: GuideType;
  /** Matches the title, slug or build, case-insensitively. */
  q?: string;
  limit?: number;
  offset?: number;
}

/** Guides of the team, newest first, each with its app. */
export async function listGuides(db: Db, teamId: string, query: GuideFilters = {}) {
  const filters = [eq(apps.teamId, teamId)];
  if (query.appId) filters.push(eq(guides.appId, query.appId));
  if (query.areaId) filters.push(eq(guides.areaId, query.areaId));
  const status = query.status ?? "active";
  if (status !== "all") filters.push(eq(guides.status, status));
  if (query.build) filters.push(eq(guides.build, query.build));
  if (query.type) filters.push(eq(guides.type, query.type));
  if (query.environment) {
    filters.push(sql`${guides.environments} @> ${JSON.stringify([query.environment])}::jsonb`);
  }
  const q = query.q?.trim();
  if (q) {
    const pattern = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    filters.push(or(ilike(guides.title, pattern), ilike(guides.slug, pattern), ilike(guides.build, pattern))!);
  }

  return db
    .select({
      id: guides.id,
      slug: guides.slug,
      title: guides.title,
      type: guides.type,
      appId: guides.appId,
      appName: apps.name,
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
    .orderBy(desc(guides.updatedAt), desc(guides.id))
    .limit(query.limit ?? 20)
    .offset(query.offset ?? 0);
}

/** One version of a guide (the current one by default) and the version history. */
export async function getGuideDetail(db: Db, teamId: string, guideId: string, version?: number) {
  const [row] = await db
    .select({ guide: guides })
    .from(guides)
    .innerJoin(apps, eq(apps.id, guides.appId))
    .where(and(eq(guides.id, guideId), eq(apps.teamId, teamId)));
  if (!row) throw new ApiError("not_found", "Guide not found.");

  const versions = await db
    .select({
      version: guideVersions.version,
      changeNote: guideVersions.changeNote,
      createdByUserId: guideVersions.createdByUserId,
      createdByTokenId: guideVersions.createdByTokenId,
      createdAt: guideVersions.createdAt,
    })
    .from(guideVersions)
    .where(eq(guideVersions.guideId, row.guide.id))
    .orderBy(desc(guideVersions.version));

  const wanted = version ?? row.guide.currentVersion;
  const [selected] = await db
    .select({ content: guideVersions.content })
    .from(guideVersions)
    .where(and(eq(guideVersions.guideId, row.guide.id), eq(guideVersions.version, wanted)));
  if (!selected) throw new ApiError("not_found", `Version ${wanted} not found.`);

  return { guide: row.guide, version: wanted, content: selected.content, versions };
}

export async function setGuideStatus(db: Db, teamId: string, guideId: string, status: GuideStatus) {
  const [found] = await db
    .select({ id: guides.id })
    .from(guides)
    .innerJoin(apps, eq(apps.id, guides.appId))
    .where(and(eq(guides.id, guideId), eq(apps.teamId, teamId)));
  if (!found) throw new ApiError("not_found", "Guide not found.");
  const [updated] = await db
    .update(guides)
    .set({ status, updatedAt: new Date() })
    .where(eq(guides.id, found.id))
    .returning();
  return updated!;
}
