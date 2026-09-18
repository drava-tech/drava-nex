/**
 * Every JSON route answers with this envelope. Two deliberate exceptions stay
 * outside it: the better-auth routes (its own shapes) and GET
 * /api/media/:id/file (a redirect a bare <video src> must be able to follow).
 */
export type ApiSuccess<T> = { success: true; data: T }
export type ApiFailure = {
  success: false
  error: { code: ApiErrorCode; message: string; issues?: unknown }
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure

export type ApiErrorCode =
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "STORAGE_UNAVAILABLE"
  | "INTERNAL"

export const ROLES = ["ADMIN", "OPERATOR", "VIEWER"] as const
export type Role = (typeof ROLES)[number]

export type Page<T> = { items: T[]; nextCursor: string | null }
