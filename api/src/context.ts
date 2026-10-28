import { and, asc, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { Db } from "./db/client.ts";
import type { UserDirectory } from "./directory.ts";
import type { NotificationContext } from "./services/notifications.ts";
import type { EvidenceStorage } from "./storage.ts";
import type { Updater } from "./updater.ts";
import { memberships, roleRank, teams, type Locale, type Role } from "./db/schema.ts";
import { ApiError } from "./errors.ts";
import { acceptPendingInvitations } from "./services/invitations.ts";

export interface AppEnv {
  Variables: {
    db: Db;
    user: { id: string; email: string; name: string | null; locale: Locale };
    updates: { repository: string | null; fetch?: typeof fetch; updater: Updater | null };
    evidence: EvidenceStorage | null;
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

/** The team the web app works in, for people in several teams; agent tokens carry their own. */
export const TEAM_HEADER = "x-guidepass-team";

/** Every team the person is in, oldest membership first. */
export async function listMemberships(db: Db, userId: string): Promise<Membership[]> {
  return db
    .select({ teamId: memberships.teamId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt), asc(memberships.teamId));
}

/**
 * The signed-in person's membership in the team the request names (`X-Guidepass-Team`),
 * or in their first team when it names none. Naming a team they are not in finds
 * nothing, so a stale choice never acts in another team; `fallback` (for `/me`) picks
 * the first team instead, so the web app can recover.
 */
export async function findMembership(c: Context<AppEnv>, options: { fallback?: boolean } = {}): Promise<Membership | undefined> {
  const wanted = c.req.header(TEAM_HEADER);
  const pick = (all: Membership[]) => (wanted ? (all.find((m) => m.teamId === wanted) ?? (options.fallback ? all[0] : undefined)) : all[0]);
  const found = pick(await listMemberships(c.var.db, c.var.user.id));
  if (found || wanted) return found;
  // First sign-in after being invited: join the team on the spot.
  return (await acceptPendingInvitations(c.var.db, c.var.user)) ? pick(await listMemberships(c.var.db, c.var.user.id)) : undefined;
}

/** The caller's membership, at least `role` if given (owners can do what writers can). */
export async function requireMembership(c: Context<AppEnv>, role?: Role): Promise<Membership> {
  const membership = await findMembership(c);
  if (!membership) {
    if (c.req.header(TEAM_HEADER)) {
      throw new ApiError("forbidden", "You are not a member of this team. Reload the page to switch to one of yours.", { reason: "not_in_team" });
    }
    throw new ApiError("forbidden", "You are not a member of a team yet.");
  }
  if (role && roleRank[membership.role] < roleRank[role]) {
    throw new ApiError("forbidden", role === "owner" ? "Only team owners can do this." : "Only writers and owners can do this.");
  }
  return membership;
}

/** The first team set up on this instance: its owners run the instance itself. */
export async function firstTeamId(db: Db): Promise<string | undefined> {
  const [first] = await db.select({ id: teams.id }).from(teams).orderBy(asc(teams.createdAt), asc(teams.id)).limit(1);
  return first?.id;
}

/**
 * Owners of the first team administer the instance: its environments, its updates,
 * and new teams. Owners of other teams run only their own team.
 */
export async function isInstanceAdmin(db: Db, userId: string): Promise<boolean> {
  const teamId = await firstTeamId(db);
  if (!teamId) return false;
  const [owner] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId), eq(memberships.role, "owner")));
  return !!owner;
}

export async function requireInstanceAdmin(c: Context<AppEnv>): Promise<void> {
  if (!(await isInstanceAdmin(c.var.db, c.var.user.id))) {
    throw new ApiError("forbidden", "Only owners of the instance's first team can do this.");
  }
}
