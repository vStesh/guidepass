import { and, asc, eq, isNull, or } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { invitations, memberships, users } from "../db/schema.ts";

/**
 * Turns every pending invitation for this person's email into a membership: one per
 * team that invited them. Called on sign-in (`/me`) and when someone without a team
 * makes a request; returns how many teams they joined. Someone without a name gets
 * the one the owner typed in the first invitation.
 */
export async function acceptPendingInvitations(db: Db, user: { id: string; email: string; name: string | null }): Promise<number> {
  const pendingFor = and(eq(invitations.email, user.email.toLowerCase()), eq(invitations.status, "pending"));
  // Most sign-ins have nothing pending: skip the transaction then.
  const [any] = await db.select({ id: invitations.id }).from(invitations).where(pendingFor).limit(1);
  if (!any) return 0;
  return db.transaction(async (tx) => {
    const pending = await tx
      .select()
      .from(invitations)
      .where(pendingFor)
      .orderBy(asc(invitations.createdAt))
      .for("update");
    for (const invitation of pending) {
      await tx
        .insert(memberships)
        .values({ teamId: invitation.teamId, userId: user.id, role: invitation.role })
        .onConflictDoNothing();
      if (invitation.name && !user.name) {
        // The owner's spelling only fills a gap; a name the person chose wins.
        const [named] = await tx
          .update(users)
          .set({ name: invitation.name })
          .where(and(eq(users.id, user.id), or(isNull(users.name), eq(users.name, ""))))
          .returning({ name: users.name });
        if (named) user.name = named.name;
      }
      await tx
        .update(invitations)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(eq(invitations.id, invitation.id));
    }
    return pending.length;
  });
}
