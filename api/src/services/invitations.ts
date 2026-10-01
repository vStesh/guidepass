import { and, eq, isNull, or } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { invitations, memberships, users } from "../db/schema.ts";

/**
 * Turns a pending invitation for this person's email into a membership.
 * Called when someone without a team signs in; returns whether they joined.
 * Someone without a name gets the one the owner typed in the invitation.
 */
export async function acceptPendingInvitation(db: Db, user: { id: string; email: string; name: string | null }): Promise<boolean> {
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
    return true;
  });
}
