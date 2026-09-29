import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type { Db } from "./db/client.ts";
import { memberships, type Role } from "./db/schema.ts";
import { ApiError } from "./errors.ts";

export interface AppEnv {
  Variables: {
    db: Db;
    user: { id: string; email: string; name: string | null };
    /** Only this email may run `/setup`; unset in local development. */
    ownerEmail: string | undefined;
  };
}

export interface Membership {
  teamId: string;
  role: Role;
}

/**
 * The signed-in person's team. One instance serves one project, so v1 has a
 * single team per person.
 */
export async function requireMembership(c: Context<AppEnv>, role?: Role): Promise<Membership> {
  const [membership] = await c.var.db
    .select({ teamId: memberships.teamId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, c.var.user.id))
    .limit(1);
  if (!membership) throw new ApiError("forbidden", "You are not a member of a team yet.");
  if (role === "owner" && membership.role !== "owner") {
    throw new ApiError("forbidden", "Only team owners can do this.");
  }
  return membership;
}
