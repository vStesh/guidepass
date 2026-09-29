import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireMembership, type AppEnv } from "../context.ts";
import type { Db } from "../db/client.ts";
import { invitations, memberships, users } from "../db/schema.ts";
import { ApiError } from "../errors.ts";
import { validate } from "../validate.ts";

export const memberRoutes = new Hono<AppEnv>();

const role = z.enum(["owner", "tester"]);

memberRoutes.get("/members", async (c) => {
  const { teamId } = await requireMembership(c);
  const rows = await c.var.db
    .select({ id: users.id, email: users.email, name: users.name, role: memberships.role, joinedAt: memberships.createdAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.teamId, teamId))
    .orderBy(asc(users.email));
  return c.json({ members: rows });
});

/** A team keeps at least one owner. */
async function assertAnotherOwner(db: Db, teamId: string, userId: string) {
  const others = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.teamId, teamId), eq(memberships.role, "owner"), ne(memberships.userId, userId)))
    .limit(1);
  if (!others.length) throw new ApiError("conflict", "A team needs at least one owner.");
}

memberRoutes.patch(
  "/members/:userId",
  validate("param", z.object({ userId: z.string().min(1) })),
  validate("json", z.object({ role })),
  async (c) => {
    const { teamId } = await requireMembership(c, "owner");
    const { userId } = c.req.valid("param");
    const { role: newRole } = c.req.valid("json");
    const [member] = await c.var.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)));
    if (!member) throw new ApiError("not_found", "Member not found.");
    if (member.role === "owner" && newRole !== "owner") await assertAnotherOwner(c.var.db, teamId, userId);
    await c.var.db
      .update(memberships)
      .set({ role: newRole })
      .where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)));
    return c.json({ member: { userId, role: newRole } });
  },
);

/** Removes someone from the team. Their runs and results stay. */
memberRoutes.delete(
  "/members/:userId",
  validate("param", z.object({ userId: z.string().min(1) })),
  async (c) => {
    const { teamId } = await requireMembership(c, "owner");
    const { userId } = c.req.valid("param");
    const [member] = await c.var.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)));
    if (!member) throw new ApiError("not_found", "Member not found.");
    if (member.role === "owner") await assertAnotherOwner(c.var.db, teamId, userId);
    await c.var.db.delete(memberships).where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)));
    return c.json({ removed: userId });
  },
);

memberRoutes.get("/invitations", async (c) => {
  const { teamId } = await requireMembership(c, "owner");
  const rows = await c.var.db
    .select()
    .from(invitations)
    .where(and(eq(invitations.teamId, teamId), eq(invitations.status, "pending")))
    .orderBy(desc(invitations.createdAt));
  return c.json({ invitations: rows });
});

/**
 * Invite someone by email. In a pool Guidepass owns, this creates their account
 * and Cognito emails a temporary password; in a shared pool they must already
 * have an account. They join the team the first time they sign in. Inviting a
 * pending person again resends the password (answers 200 instead of 201).
 */
memberRoutes.post(
  "/invitations",
  validate("json", z.object({ email: z.email().max(254), role: role.default("tester") })),
  async (c) => {
    const { teamId } = await requireMembership(c, "owner");
    const body = c.req.valid("json");
    const email = body.email.toLowerCase();

    const [member] = await c.var.db
      .select({ id: users.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.teamId, teamId), sql`lower(${users.email}) = ${email}`));
    if (member) throw new ApiError("conflict", `${email} is already in the team.`);

    const [pending] = await c.var.db
      .select()
      .from(invitations)
      .where(and(eq(invitations.teamId, teamId), eq(invitations.email, email), eq(invitations.status, "pending")));

    // Inviting again resends the temporary password if it was never used.
    const account = await c.var.directory.ensureUser(email);
    if (pending) return c.json({ invitation: pending, accountCreated: account === "created" });

    if (account === "missing") {
      throw new ApiError(
        "invalid",
        `${email} has no account in this user pool. Ask the pool's administrator to add them first.`,
        { reason: "no_account" },
      );
    }

    const [invitation] = await c.var.db
      .insert(invitations)
      .values({ teamId, email, role: body.role, invitedBy: c.var.user.id })
      .returning();
    return c.json({ invitation, accountCreated: account === "created" }, 201);
  },
);

memberRoutes.delete(
  "/invitations/:invitationId",
  validate("param", z.object({ invitationId: z.uuid() })),
  async (c) => {
    const { teamId } = await requireMembership(c, "owner");
    const [revoked] = await c.var.db
      .update(invitations)
      .set({ status: "revoked" })
      .where(
        and(
          eq(invitations.id, c.req.valid("param").invitationId),
          eq(invitations.teamId, teamId),
          eq(invitations.status, "pending"),
        ),
      )
      .returning();
    if (!revoked) throw new ApiError("not_found", "Pending invitation not found.");
    return c.json({ invitation: revoked });
  },
);
