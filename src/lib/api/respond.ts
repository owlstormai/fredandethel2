import type { ZodType } from "zod";
import type { ApiError } from "./contracts";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function jsonOk<T>(data: T, init: ResponseInit = {}): Response {
  return Response.json(data, { status: 200, ...init });
}

export function jsonError(status: number, code: string, message: string, details?: unknown): Response {
  const body: ApiError = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
  return Response.json(body, { status });
}

/** Parse and validate a JSON body; throws HttpError(400) on failure. */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HttpError(400, "validation_failed", "Request body failed validation.", result.error.flatten());
  }
  return result.data;
}

/**
 * Wrap a route handler: converts HttpError into a JSON error response and
 * hides internal error details from clients (logged server-side, redacted).
 */
export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.status, error.code, error.message, error.details);
      }
      // Lazy import keeps this module usable in tests without the logger.
      const { logError } = await import("@/lib/privacy/logging");
      logError("unhandled_route_error", error);
      return jsonError(500, "internal_error", "Something went wrong on our side.");
    }
  };
}
