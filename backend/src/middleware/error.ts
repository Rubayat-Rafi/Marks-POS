import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

/**
 * Standard API error class with status code, machine-readable code, and optional field errors.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }

  static badRequest(message: string, fields?: Record<string, string>) {
    return new ApiError(400, "bad_request", message, fields);
  }
  static unauthorized(message = "Sign in to continue.") {
    return new ApiError(401, "unauthorized", message);
  }
  static forbidden(message = "You do not have permission to do that.") {
    return new ApiError(403, "forbidden", message);
  }
  static notFound(message = "Not found.") {
    return new ApiError(404, "not_found", message);
  }
  static conflict(message: string) {
    return new ApiError(409, "conflict", message);
  }
  static unprocessable(message: string, fields?: Record<string, string>) {
    return new ApiError(422, "unprocessable", message, fields);
  }
}

/**
 * Async wrapper to catch promises and forward errors to Express next().
 */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}

/**
 * 404 Not Found fallback middleware.
 */
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: { code: "not_found", message: `No route for ${req.method} ${req.path}` },
    requestId: res.locals.requestId,
  });
}

/**
 * Global error handling middleware.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const requestId = res.locals.requestId;

  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.errors) {
      fields[issue.path.join(".") || "_"] = issue.message;
    }
    res.status(422).json({
      error: { code: "validation_failed", message: "Check the highlighted fields.", fields },
      requestId,
    });
    return;
  }

  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, fields: err.fields },
      requestId,
    });
    return;
  }

  // Prisma unique-constraint violations surface as a conflict (409)
  const anyErr = err as { code?: string; meta?: { target?: string[] } };
  if (anyErr?.code === "P2002") {
    res.status(409).json({
      error: {
        code: "conflict",
        message: `A record with that ${anyErr.meta?.target?.join(", ") ?? "value"} already exists.`,
      },
      requestId,
    });
    return;
  }
  if (anyErr?.code === "P2025") {
    res.status(404).json({ error: { code: "not_found", message: "Not found." }, requestId });
    return;
  }

  console.error("[api] unhandled error", err);
  res.status(500).json({
    error: { code: "internal_error", message: "Something went wrong on our side." },
    requestId,
  });
}
