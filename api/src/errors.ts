import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid";

const statusByCode: Record<ErrorCode, ContentfulStatusCode> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invalid: 422,
};

/** Thrown by routes and services; rendered as `{ error: { code, message, details } }`. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  get status(): ContentfulStatusCode {
    return statusByCode[this.code];
  }
}

/**
 * Postgres unique-constraint violation, whichever driver raised it. Drizzle wraps
 * driver errors in `cause`; PGlite sets `code`, the Data API only has the message.
 */
export function isUniqueViolation(err: unknown): boolean {
  for (let e = err as { code?: unknown; message?: unknown; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === "23505") return true;
    if (typeof e.message === "string" && /duplicate key value violates unique constraint/i.test(e.message)) return true;
  }
  return false;
}
