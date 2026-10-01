import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireMembership, type AppEnv } from "../context.ts";
import type { Db } from "../db/client.ts";
import { invitations, memberships, users } from "../db/schema.ts";
import { ApiError } from "../errors.ts";
import { revokeTokensOf } from "../services/agentTokens.ts";
import { validate } from "../validate.ts";

export const memberRoutes = new Hono<AppEnv>();

const role = z.enum(["owner", "writer", "tester"]);

memberRoutes.get("/members", async (c) => {
  const { teamId } = await requireMembership(c);
  const rows = await c.var.db
    .select({ id: users.id, email: users.email, name: users.name, role: memberships.role, joinedAt: memberships.createdAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.teamId, teamId))
    .orderBy(asc(sql`lower(coalesce(${users.name}, ${users.email}))`));
  return c.json({ members: rows });
});

/**
 * A team keeps at least one owner. Called inside the transaction that demotes or
 * removes someone: the owners' rows stay locked until it commits, so two owners
 * demoting each other at once can't both succeed.
 */
async function assertAnotherOwner(db: Db, teamId: string, userId: string) {
  const owners = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.teamId, teamId), eq(memberships.role, "owner")))
    .for("update");
  if (!owners.some((o) => o.userId !== userId)) throw new ApiError("conflict", "A team needs at least one owner.");
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
    await c.var.db.transaction(async (tx) => {
      if (member.role === "owner" && newRole !== "owner") await assertAnotherOwner(tx as Db, teamId, userId);
      await tx
        .update(memberships)
        .set({ role: newRole })
        .where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)));
    });
    return c.json({ member: { userId, role: newRole } });
  },
);

/** Removes someone from the team and revokes their agent tokens. Their runs and results stay. */
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
    await c.var.db.transaction(async (tx) => {
      if (member.role === "owner") await assertAnotherOwner(tx as Db, teamId, userId);
      await tx.delete(memberships).where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)));
      // Their agents lose access too.
      await revokeTokensOf(tx as Db, teamId, userId);
    });
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
  validate("json", z.object({ email: z.email().max(254), name: z.string().trim().min(1).max(100).optional(), role: role.default("tester") })),
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
    if (pending) {
      if (body.name && body.name !== pending.name) {
        const [renamed] = await c.var.db
          .update(invitations)
          .set({ name: body.name })
          .where(eq(invitations.id, pending.id))
          .returning();
        return c.json({ invitation: renamed, accountCreated: account === "created" });
      }
      return c.json({ invitation: pending, accountCreated: account === "created" });
    }

    if (account === "missing") {
      throw new ApiError(
        "invalid",
        `${email} has no account in this user pool. Ask the pool's administrator to add them first.`,
        { reason: "no_account" },
      );
    }

    const [invitation] = await c.var.db
      .insert(invitations)
      .values({ teamId, email, name: body.name ?? null, role: body.role, invitedBy: c.var.user.id })
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
