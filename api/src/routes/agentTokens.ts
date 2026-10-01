import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireMembership, type AppEnv } from "../context.ts";
import type { Db } from "../db/client.ts";
import { agentTokens, guideVersions, memberships, users } from "../db/schema.ts";
import { ApiError } from "../errors.ts";
import { createAgentToken } from "../services/agentTokens.ts";
import { validate } from "../validate.ts";

/**
 * Tokens AI agents use to reach the MCP server. Each token is held by one member:
 * what the agent uploads is shown as theirs. Owners manage everyone's tokens;
 * writers create tokens for themselves; testers get theirs from an owner. Everyone
 * sees and can revoke the tokens they hold.
 */
export const agentTokenRoutes = new Hono<AppEnv>();

const tokenParam = validate("param", z.object({ tokenId: z.uuid() }));

/** Locks the membership row so the member can't be removed until the token is written. */
async function assertMember(db: Db, teamId: string, userId: string) {
  const [member] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)))
    .for("share");
  if (!member) throw new ApiError("invalid", "A token can only be held by a member of the team.");
}

agentTokenRoutes.get("/agent-tokens", async (c) => {
  const { teamId, role } = await requireMembership(c);
  const rows = await c.var.db
    .select({
      id: agentTokens.id,
      name: agentTokens.name,
      scope: agentTokens.scope,
      userId: agentTokens.userId,
      userName: sql<string>`coalesce(${users.name}, ${users.email})`,
      createdAt: agentTokens.createdAt,
      lastUsedAt: agentTokens.lastUsedAt,
    })
    .from(agentTokens)
    .innerJoin(users, eq(users.id, agentTokens.userId))
    .where(
      and(
        eq(agentTokens.teamId, teamId),
        isNull(agentTokens.revokedAt),
        role === "owner" ? undefined : eq(agentTokens.userId, c.var.user.id),
      ),
    )
    .orderBy(desc(agentTokens.createdAt));
  return c.json({ tokens: rows });
});

agentTokenRoutes.post(
  "/agent-tokens",
  validate(
    "json",
    z.object({
      name: z.string().trim().min(1).max(100),
      scope: z.enum(["read", "write"]),
      /** The member the agent acts for; the owner creating it by default. */
      userId: z.string().min(1).optional(),
    }),
  ),
  async (c) => {
    const { teamId, role } = await requireMembership(c, "writer");
    const { userId = c.var.user.id, ...body } = c.req.valid("json");
    if (role !== "owner" && userId !== c.var.user.id) {
      throw new ApiError("forbidden", "Writers create tokens only for themselves.");
    }
    const token = await c.var.db.transaction(async (tx) => {
      await assertMember(tx as Db, teamId, userId);
      return createAgentToken(tx as Db, { ...body, teamId, createdBy: c.var.user.id, userId });
    });
    return c.json({ token }, 201);
  },
);

/**
 * Hands a token to another member. Uploads keep the author recorded at the
 * time, unless `includePastUploads` moves the token's earlier uploads by its
 * previous holder too: for a token that was given to someone under the wrong name.
 */
agentTokenRoutes.patch(
  "/agent-tokens/:tokenId",
  tokenParam,
  validate("json", z.object({ userId: z.string().min(1), includePastUploads: z.boolean().default(false) })),
  async (c) => {
    const { teamId } = await requireMembership(c, "owner");
    const { userId, includePastUploads } = c.req.valid("json");
    const tokenId = c.req.valid("param").tokenId;
    const result = await c.var.db.transaction(async (tx) => {
      await assertMember(tx as Db, teamId, userId);
      const [current] = await tx
        .select({ userId: agentTokens.userId })
        .from(agentTokens)
        .where(and(eq(agentTokens.id, tokenId), eq(agentTokens.teamId, teamId), isNull(agentTokens.revokedAt)))
        .for("update");
      if (!current) throw new ApiError("not_found", "Token not found.");
      await tx.update(agentTokens).set({ userId }).where(eq(agentTokens.id, tokenId));
      let movedUploads = 0;
      if (includePastUploads && current.userId !== userId) {
        const moved = await tx
          .update(guideVersions)
          .set({ createdByUserId: userId })
          .where(and(eq(guideVersions.createdByTokenId, tokenId), eq(guideVersions.createdByUserId, current.userId)))
          .returning({ id: guideVersions.id });
        movedUploads = moved.length;
      }
      return { movedUploads };
    });
    return c.json({ token: { id: tokenId, userId }, ...result });
  },
);

agentTokenRoutes.delete("/agent-tokens/:tokenId", tokenParam, async (c) => {
  const { teamId, role } = await requireMembership(c);
  const [revoked] = await c.var.db
    .update(agentTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(agentTokens.id, c.req.valid("param").tokenId),
        eq(agentTokens.teamId, teamId),
        isNull(agentTokens.revokedAt),
        // Others' tokens look missing, not forbidden: their ids aren't revealed.
        role === "owner" ? undefined : eq(agentTokens.userId, c.var.user.id),
      ),
    )
    .returning({ id: agentTokens.id });
  if (!revoked) throw new ApiError("not_found", "Token not found.");
  return c.json({ revoked: revoked.id });
});
