export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "USAGE_EXCEEDED"
  | "VALIDATION"
  | "AI_UNAVAILABLE"
  | "INTERNAL"

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number = 500
  ) {
    super(message)
    this.name = "AppError"
  }
}

export function unauthorized(message = "Please sign in"): AppError {
  return new AppError("UNAUTHORIZED", message, 401)
}

export function forbidden(message = "Access denied"): AppError {
  return new AppError("FORBIDDEN", message, 403)
}

export function notFound(message = "Not found"): AppError {
  return new AppError("NOT_FOUND", message, 404)
}

export function rateLimited(message = "Too many requests"): AppError {
  return new AppError("RATE_LIMITED", message, 429)
}

export function usageExceeded(message: string): AppError {
  return new AppError("USAGE_EXCEEDED", message, 429)
}

export function validationError(message: string): AppError {
  return new AppError("VALIDATION", message, 400)
}
