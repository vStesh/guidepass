import { createHash, randomBytes } from "node:crypto";
import { and, eq, exists, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { agentTokens, memberships, type TokenScope } from "../db/schema.ts";

const PREFIX = "gp_";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates a token for an AI agent. The token itself is returned once and never stored. */
export async function createAgentToken(
  db: Db,
  input: { teamId: string; name: string; scope: TokenScope; createdBy: string; userId: string },
) {
  const token = PREFIX + randomBytes(32).toString("base64url");
  const [row] = await db
    .insert(agentTokens)
    .values({ ...input, tokenHash: hashToken(token) })
    .returning({
      id: agentTokens.id,
      name: agentTokens.name,
      scope: agentTokens.scope,
      userId: agentTokens.userId,
      createdAt: agentTokens.createdAt,
    });
  return { ...row!, token };
}

export interface AgentIdentity {
  tokenId: string;
  teamId: string;
  scope: TokenScope;
  /** The member the agent acts for. */
  userId: string;
}

/** Resolves `Authorization: Bearer gp_…` to a live token whose holder is still in the team, or null. */
export async function authenticateAgent(db: Db, authorization: string | undefined): Promise<AgentIdentity | null> {
  const token = authorization?.match(/^Bearer (gp_[A-Za-z0-9_-]+)$/)?.[1];
  if (!token) return null;
  const [row] = await db
    .update(agentTokens)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(agentTokens.tokenHash, hashToken(token)),
        isNull(agentTokens.revokedAt),
        exists(
          db
            .select({ one: sql`1` })
            .from(memberships)
            .where(and(eq(memberships.teamId, agentTokens.teamId), eq(memberships.userId, agentTokens.userId))),
        ),
      ),
    )
    .returning({ tokenId: agentTokens.id, teamId: agentTokens.teamId, scope: agentTokens.scope, userId: agentTokens.userId });
  return row ?? null;
}

/** Revokes every live token a member holds, when they leave the team. */
export async function revokeTokensOf(db: Db, teamId: string, userId: string) {
  await db
    .update(agentTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(agentTokens.teamId, teamId), eq(agentTokens.userId, userId), isNull(agentTokens.revokedAt)));
}
