// BL29 / CLAUDE.md rule 10: every error body is { code, message, details }, never a stack trace.
// One place for codes, statuses and default (Indonesian) messages so endpoints do not invent their own.
export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  PLAN_LIMIT_REACHED: "PLAN_LIMIT_REACHED",
  SUBSCRIPTION_READ_ONLY: "SUBSCRIPTION_READ_ONLY",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export function errorResponse(
  status: number,
  code: string,
  message: string,
  details: unknown = null,
): Response {
  return Response.json({ code, message, details }, { status });
}

export function validationError(message = "Data yang dikirim tidak valid.", details?: unknown) {
  return errorResponse(400, ERROR_CODES.VALIDATION_ERROR, message, details);
}

export function unauthenticated(message = "Sesi tidak valid. Silakan masuk lagi.") {
  return errorResponse(401, ERROR_CODES.UNAUTHENTICATED, message);
}

export function forbidden(message = "Anda tidak punya akses untuk tindakan ini.") {
  return errorResponse(403, ERROR_CODES.FORBIDDEN, message);
}

const NOT_FOUND_MESSAGE = "Data tidak ditemukan.";

// Also used for another organization's resource (rule 2): same body, so existence is not revealed.
export function notFound(message = NOT_FOUND_MESSAGE) {
  return errorResponse(404, ERROR_CODES.NOT_FOUND, message);
}

export function conflict(message: string, details?: unknown) {
  return errorResponse(409, ERROR_CODES.CONFLICT, message, details);
}

export function insufficientStock(details?: unknown, message = "Stok tidak mencukupi.") {
  return errorResponse(409, ERROR_CODES.INSUFFICIENT_STOCK, message, details);
}

export function planLimitReached(
  details?: unknown,
  message = "Batas paket Anda sudah tercapai. Upgrade paket untuk melanjutkan.",
) {
  return errorResponse(403, ERROR_CODES.PLAN_LIMIT_REACHED, message, details);
}

export function subscriptionReadOnly(
  message = "Langganan Anda sedang dalam mode baca saja. Perbarui langganan untuk mengubah data.",
) {
  return errorResponse(403, ERROR_CODES.SUBSCRIPTION_READ_ONLY, message);
}

// No cause or stack goes in the body; the caller logs the error separately.
export function internalError(message = "Terjadi kesalahan pada server.") {
  return errorResponse(500, ERROR_CODES.INTERNAL_ERROR, message);
}

// A known, expected failure. Services and handlers throw it; withApiLog turns it into the BL29
// response, so no layer builds an error Response by hand and anything else becomes a 500.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }

  toResponse(): Response {
    return errorResponse(this.status, this.code, this.message, this.details);
  }
}

// The ONE 404 for "missing" and "belongs to another organization" (rule 2). Services, the ownership
// helpers and the tenant client all throw this, so the bodies cannot drift apart; the cross-tenant
// harness compares them byte for byte.
export function notFoundError(): ApiError {
  return new ApiError(404, ERROR_CODES.NOT_FOUND, NOT_FOUND_MESSAGE);
}
