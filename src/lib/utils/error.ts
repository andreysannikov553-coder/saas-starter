import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { logger } from "@/lib/utils/logger";
import { ERROR_MESSAGES } from "@/lib/constants";

/**
 * Custom error classes for better error handling
 */

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = "Authentication required") {
    super(message, 401, "AUTHENTICATION_ERROR");
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = "You don't have permission to perform this action") {
    super(message, 403, "AUTHORIZATION_ERROR");
    this.name = "AuthorizationError";
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string = "Validation failed",
    public errors?: Record<string, string[]>
  ) {
    super(message, 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Resource not found") {
    super(message, 404, "NOT_FOUND_ERROR");
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = "Rate limit exceeded") {
    super(message, 429, "RATE_LIMIT_ERROR");
    this.name = "RateLimitError";
  }
}

/**
 * Format error for API responses
 */
export function formatErrorResponse(error: unknown) {
  if (error instanceof AppError) {
    return {
      error: {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        ...(error instanceof ValidationError && error.errors ? { errors: error.errors } : {}),
      },
    };
  }

  if (error instanceof Error) {
    return {
      error: {
        message: error.message,
        statusCode: 500,
      },
    };
  }

  return {
    error: {
      message: "An unexpected error occurred",
      statusCode: 500,
    },
  };
}

/**
 * Turn an error into a message that is safe to show a user.
 *
 * Only messages we wrote ourselves are shown. Anything else — a Prisma error
 * naming tables and columns, a provider SDK error, an unexpected throw — is
 * logged and replaced with a generic message, because those texts describe our
 * internals and reach the user verbatim otherwise.
 */
export function toUserMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? ERROR_MESSAGES.VALIDATION_ERROR;
  }
  if (error instanceof AppError) {
    return error.message;
  }
  return ERROR_MESSAGES.SERVER_ERROR;
}

/**
 * Field-level messages from a Zod failure, for rendering next to inputs.
 */
export function toFieldErrors(error: unknown): Record<string, string> | undefined {
  if (!(error instanceof ZodError)) return undefined;

  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !(key in fields)) fields[key] = issue.message;
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

/**
 * Handle async errors in server actions.
 *
 * `unstable_rethrow` first: `redirect()` and `notFound()` are implemented as
 * thrown errors, so a catch-all here would swallow them and turn a successful
 * redirect into `{ error: "NEXT_REDIRECT" }`.
 */
export async function handleServerAction<T>(
  action: () => Promise<T>
): Promise<{ data?: T; error?: string; fieldErrors?: Record<string, string> }> {
  try {
    const data = await action();
    return { data };
  } catch (error) {
    unstable_rethrow(error);

    logger.error("Server action failed", error);

    return {
      error: toUserMessage(error),
      fieldErrors: toFieldErrors(error),
    };
  }
}
