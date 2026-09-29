import { validate } from "../validate.ts";
import { asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { findMembership, requireMembership, type AppEnv } from "../context.ts";
import { environments, memberships, teams, users } from "../db/schema.ts";
import { ApiError } from "../errors.ts";

export const teamRoutes = new Hono<AppEnv>();

/** The signed-in person and their team, or `team: null` before setup or an invitation. */
teamRoutes.get("/me", async (c) => {
  const membership = await findMembership(c);
  if (!membership) return c.json({ user: c.var.user, team: null });
  const [team] = await c.var.db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.id, membership.teamId));
  return c.json({ user: c.var.user, team: { ...team!, role: membership.role } });
});

/** Update your own profile: display name and interface language. */
teamRoutes.patch(
  "/me",
  validate(
    "json",
    z.object({ name: z.string().trim().min(1).max(100).optional(), locale: z.enum(["en", "uk"]).optional() }),
  ),
  async (c) => {
    const body = c.req.valid("json");
    if (!Object.keys(body).length) return c.json({ user: c.var.user });
    const [user] = await c.var.db
      .update(users)
      .set(body)
      .where(eq(users.id, c.var.user.id))
      .returning({ id: users.id, email: users.email, name: users.name, locale: users.locale });
    return c.json({ user });
  },
);

/**
 * First sign-in on a fresh instance: creates the team and makes the caller its owner.
 * Deployed instances allow this only for the email set at deploy (`OWNER_EMAIL`),
 * so nobody else in a shared user pool can claim it. Everyone else joins by invitation.
 */
teamRoutes.post(
  "/setup",
  validate("json", z.object({ teamName: z.string().trim().min(1).max(100) })),
  async (c) => {
    const ownerEmail = c.get("ownerEmail");
    if (ownerEmail && c.var.user.email.toLowerCase() !== ownerEmail.toLowerCase()) {
      throw new ApiError("forbidden", "Only the owner configured for this instance can set it up.");
    }
    const { teamName } = c.req.valid("json");
    const team = await c.var.db.transaction(async (tx) => {
      // Serialize concurrent first sign-ins so only one team is ever created.
      await tx.execute(sql`lock table ${teams} in exclusive mode`);
      const existing = await tx.select({ id: teams.id }).from(teams).limit(1);
      if (existing.length) throw new ApiError("conflict", "This instance is already set up.");
      const [created] = await tx.insert(teams).values({ name: teamName }).returning();
      await tx.insert(memberships).values({ teamId: created!.id, userId: c.var.user.id, role: "owner" });
      return created!;
    });
    return c.json({ team: { id: team.id, name: team.name, role: "owner" } }, 201);
  },
);

teamRoutes.get("/environments", async (c) => {
  await requireMembership(c);
  const rows = await c.var.db
    .select({ key: environments.key, name: environments.name, archived: environments.archived })
    .from(environments)
    .orderBy(asc(environments.position));
  return c.json({ environments: rows });
});
