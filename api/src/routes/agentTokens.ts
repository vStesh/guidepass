import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireMembership, type AppEnv } from "../context.ts";
import { agentTokens } from "../db/schema.ts";
import { ApiError } from "../errors.ts";
import { createAgentToken } from "../services/agentTokens.ts";
import { validate } from "../validate.ts";

/** Owners manage the tokens AI agents use to reach the MCP server. */
export const agentTokenRoutes = new Hono<AppEnv>();

agentTokenRoutes.get("/agent-tokens", async (c) => {
  const { teamId } = await requireMembership(c, "owner");
  const rows = await c.var.db
    .select({
      id: agentTokens.id,
      name: agentTokens.name,
      scope: agentTokens.scope,
      createdAt: agentTokens.createdAt,
      lastUsedAt: agentTokens.lastUsedAt,
    })
    .from(agentTokens)
    .where(and(eq(agentTokens.teamId, teamId), isNull(agentTokens.revokedAt)))
    .orderBy(desc(agentTokens.createdAt));
  return c.json({ tokens: rows });
});

agentTokenRoutes.post(
  "/agent-tokens",
  validate("json", z.object({ name: z.string().trim().min(1).max(100), scope: z.enum(["read", "write"]) })),
  async (c) => {
    const { teamId } = await requireMembership(c, "owner");
    const token = await createAgentToken(c.var.db, { ...c.req.valid("json"), teamId, createdBy: c.var.user.id });
    return c.json({ token }, 201);
  },
);

agentTokenRoutes.delete(
  "/agent-tokens/:tokenId",
  validate("param", z.object({ tokenId: z.uuid() })),
  async (c) => {
    const { teamId } = await requireMembership(c, "owner");
    const [revoked] = await c.var.db
      .update(agentTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(agentTokens.id, c.req.valid("param").tokenId), eq(agentTokens.teamId, teamId), isNull(agentTokens.revokedAt)),
      )
      .returning({ id: agentTokens.id });
    if (!revoked) throw new ApiError("not_found", "Token not found.");
    return c.json({ revoked: revoked.id });
  },
);
