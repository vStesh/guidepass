import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { invitations, memberships } from "../db/schema.ts";

/**
 * Turns a pending invitation for this person's email into a membership.
 * Called when someone without a team signs in; returns whether they joined.
 */
export async function acceptPendingInvitation(db: Db, user: { id: string; email: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(invitations)
      .where(and(eq(invitations.email, user.email.toLowerCase()), eq(invitations.status, "pending")))
      .limit(1)
      .for("update");
    if (!invitation) return false;

    await tx
      .insert(memberships)
      .values({ teamId: invitation.teamId, userId: user.id, role: invitation.role })
      .onConflictDoNothing();
    await tx
      .update(invitations)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(invitations.id, invitation.id));
    return true;
  });
}
