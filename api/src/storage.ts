import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Image types accepted as proof. */
export const evidenceTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export type EvidenceType = (typeof evidenceTypes)[number];

/** Largest screenshot, after the web app has scaled it down (usually a few hundred KB). */
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
/** Screenshots per result. */
export const MAX_EVIDENCE_FILES = 5;

/**
 * Where screenshots attached to results are kept: a private bucket the browser
 * uploads to directly and reads from with short-lived links.
 */
export interface EvidenceStorage {
  /** A short-lived form (2 minutes) the browser posts the file to; S3 enforces key, type and size. */
  presignUpload(key: string, contentType: EvidenceType): Promise<{ url: string; fields: Record<string, string> }>;
  /** The stored object's size and type, or null if nothing was uploaded. */
  head(key: string): Promise<{ size: number; contentType: string } | null>;
  /** A link to view the file, valid for an hour. */
  viewUrl(key: string): Promise<string>;
  remove(key: string): Promise<void>;
}

export function s3EvidenceStorage(bucket: string): EvidenceStorage {
  const s3 = new S3Client({});
  return {
    async presignUpload(key, contentType) {
      return createPresignedPost(s3, {
        Bucket: bucket,
        Key: key,
        Conditions: [
          ["content-length-range", 1, MAX_EVIDENCE_BYTES],
          ["eq", "$Content-Type", contentType],
        ],
        Fields: { "Content-Type": contentType },
        Expires: 120,
      });
    },
    async head(key) {
      try {
        const object = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { size: object.ContentLength ?? 0, contentType: object.ContentType ?? "" };
      } catch (err) {
        // Without s3:ListBucket, S3 answers 403 rather than 404 for a missing object.
        const name = (err as { name?: string }).name;
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (name === "NotFound" || name === "Forbidden" || status === 404 || status === 403) return null;
        throw err;
      }
    },
    viewUrl(key) {
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 });
    },
    async remove(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
