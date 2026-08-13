/**
 * Stable, client-facing error codes. Clients (web, Android, iOS) branch on
 * these strings, so treat them as part of the public API contract.
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  /** A report was submitted before the per-user cooldown elapsed. */
  REPORT_COOLDOWN: 'REPORT_COOLDOWN',
  /** An identical report from the same user is already on record. */
  DUPLICATE_REPORT: 'DUPLICATE_REPORT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  DATABASE_ERROR: 'DATABASE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
