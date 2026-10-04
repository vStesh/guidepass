import { and, eq, gt, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { attachments } from "../db/schema.ts";
import type { EvidenceStorage } from "../storage.ts";

/** A screenshot attached as proof to one scenario of a run. */
export interface AttachmentView {
  id: string;
  contentType: string;
  size: number;
  /** Short-lived link to the image. */
  url: string;
}

export const attachmentKey = (runId: string, id: string) => `evidence/${runId}/${id}`;

/**
 * Uploaded screenshots of the given runs, grouped by `runId/scenarioKey`, each
 * with a fresh link. Uploads that were started but never finished are left out.
 */
export async function attachmentsOf(
  db: Db,
  storage: EvidenceStorage | null,
  runIds: string[],
): Promise<Map<string, AttachmentView[]>> {
  const grouped = new Map<string, AttachmentView[]>();
  if (!storage || !runIds.length) return grouped;
  const rows = await db
    .select()
    .from(attachments)
    .where(and(inArray(attachments.runId, runIds), isNotNull(attachments.uploadedAt)))
    .orderBy(attachments.createdAt);
  for (const row of rows) {
    const id = `${row.runId}/${row.scenarioKey}`;
    const list = grouped.get(id) ?? [];
    list.push({
      id: row.id,
      contentType: row.contentType,
      size: row.size,
      url: await storage.viewUrl(attachmentKey(row.runId, row.id)),
    });
    grouped.set(id, list);
  }
  return grouped;
}

/** How many screenshots a scenario of a run has, uploaded ones only. */
export async function uploadedCount(db: Db, runId: string, scenarioKey: string): Promise<number> {
  const rows = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(and(eq(attachments.runId, runId), eq(attachments.scenarioKey, scenarioKey), isNotNull(attachments.uploadedAt)));
  return rows.length;
}

/**
 * Screenshots that count against the limit: uploaded ones, and uploads started in
 * the last few minutes that may still finish (their forms are valid for 2 minutes).
 */
export async function reservedCount(db: Db, runId: string, scenarioKey: string): Promise<number> {
  const since = new Date(Date.now() - 5 * 60 * 1000);
  const rows = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(
      and(
        eq(attachments.runId, runId),
        eq(attachments.scenarioKey, scenarioKey),
        or(isNotNull(attachments.uploadedAt), and(isNull(attachments.uploadedAt), gt(attachments.createdAt, since))),
      ),
    );
  return rows.length;
}

