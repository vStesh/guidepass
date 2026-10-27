import { and, asc, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireMembership, type AppEnv } from "../context.ts";
import { devices } from "../db/schema.ts";
import { ApiError } from "../errors.ts";
import { validate } from "../validate.ts";

/**
 * Each member's saved test devices: a platform, a model, an OS and whatever else
 * matters, under a name of their choosing. Starting a run fills them in with one
 * tap. Everyone sees and changes only their own.
 */
export const deviceRoutes = new Hono<AppEnv>();

/** Enough for a drawer of test phones; keeps the picker usable. */
export const MAX_DEVICES = 30;

const deviceParam = validate("param", z.object({ deviceId: z.uuid() }));
const platform = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(30);
/** An empty string clears an optional field. */
const optional = (max: number) => z.string().trim().max(max).optional();

const fields = {
  name: z.string().trim().min(1).max(60),
  platform,
  model: z.string().trim().min(1).max(60),
  os: optional(40),
  details: optional(80),
};

const columns = {
  id: devices.id,
  name: devices.name,
  platform: devices.platform,
  model: devices.model,
  os: devices.os,
  details: devices.details,
};

const mine = (teamId: string, userId: string) => and(eq(devices.teamId, teamId), eq(devices.userId, userId));

deviceRoutes.get("/devices", async (c) => {
  const { teamId } = await requireMembership(c);
  const rows = await c.var.db
    .select(columns)
    .from(devices)
    .where(mine(teamId, c.var.user.id))
    .orderBy(asc(devices.name), asc(devices.createdAt));
  return c.json({ devices: rows });
});

deviceRoutes.post("/devices", validate("json", z.object(fields)), async (c) => {
  const { teamId } = await requireMembership(c);
  const body = c.req.valid("json");
  const [saved] = await c.var.db.select({ total: count() }).from(devices).where(mine(teamId, c.var.user.id));
  if (Number(saved?.total ?? 0) >= MAX_DEVICES) throw new ApiError("invalid", `You can save up to ${MAX_DEVICES} devices.`);
  const [device] = await c.var.db
    .insert(devices)
    .values({ ...body, os: body.os || null, details: body.details || null, teamId, userId: c.var.user.id })
    .returning(columns);
  return c.json({ device }, 201);
});

deviceRoutes.patch(
  "/devices/:deviceId",
  deviceParam,
  validate("json", z.object(fields).partial()),
  async (c) => {
    const { teamId } = await requireMembership(c);
    const body = c.req.valid("json");
    const patch = {
      ...body,
      ...(body.os !== undefined && { os: body.os || null }),
      ...(body.details !== undefined && { details: body.details || null }),
    };
    if (!Object.keys(patch).length) throw new ApiError("invalid", "Nothing to change.");
    const [device] = await c.var.db
      .update(devices)
      .set(patch)
      .where(and(eq(devices.id, c.req.valid("param").deviceId), mine(teamId, c.var.user.id)))
      .returning(columns);
    if (!device) throw new ApiError("not_found", "No such device.");
    return c.json({ device });
  },
);

/** Past runs keep their description of the device. */
deviceRoutes.delete("/devices/:deviceId", deviceParam, async (c) => {
  const { teamId } = await requireMembership(c);
  const [device] = await c.var.db
    .delete(devices)
    .where(and(eq(devices.id, c.req.valid("param").deviceId), mine(teamId, c.var.user.id)))
    .returning({ id: devices.id });
  if (!device) throw new ApiError("not_found", "No such device.");
  return c.json({ deleted: true });
});
