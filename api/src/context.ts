import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type { Db } from "./db/client.ts";
import type { UserDirectory } from "./directory.ts";
import type { NotificationContext } from "./services/notifications.ts";
import { memberships, roleRank, type Locale, type Role } from "./db/schema.ts";
import { ApiError } from "./errors.ts";
import { acceptPendingInvitation } from "./services/invitations.ts";

export interface AppEnv {
  Variables: {
    db: Db;
    user: { id: string; email: string; name: string | null; locale: Locale };
    updates: { repository: string | null; fetch?: typeof fetch };
    /** Only this email may run `/setup`; unset in local development. */
    ownerEmail: string | undefined;
    directory: UserDirectory;
    notifications: NotificationContext;
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
export async function findMembership(c: Context<AppEnv>): Promise<Membership | undefined> {
  const find = async () =>
    (
      await c.var.db
        .select({ teamId: memberships.teamId, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.userId, c.var.user.id))
        .limit(1)
    )[0];
  // First sign-in after being invited: join the team on the spot.
  return (await find()) ?? ((await acceptPendingInvitation(c.var.db, c.var.user)) ? find() : undefined);
}

/** The caller's membership, at least `role` if given (owners can do what writers can). */
export async function requireMembership(c: Context<AppEnv>, role?: Role): Promise<Membership> {
  const membership = await findMembership(c);
  if (!membership) throw new ApiError("forbidden", "You are not a member of a team yet.");
  if (role && roleRank[membership.role] < roleRank[role]) {
    throw new ApiError("forbidden", role === "owner" ? "Only team owners can do this." : "Only writers and owners can do this.");
  }
  return membership;
}
