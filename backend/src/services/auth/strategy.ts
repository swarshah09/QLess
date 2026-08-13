import type { AuthMethod, User } from '@prisma/client';

/**
 * Credential verification seam.
 *
 * Token issuance, session rotation and RBAC deliberately know nothing about
 * HOW identity was proven — they only consume the `VerifiedIdentity` returned
 * here. Adding OTP or magic-link auth later means writing another strategy and
 * registering it; no change to `auth.service`, the middleware, or the session
 * model is required.
 */

/** The outcome of a credential check. */
export type VerificationResult =
  | { ok: true; identity: VerifiedIdentity }
  | { ok: false; reason: VerificationFailure };

export interface VerifiedIdentity {
  user: User;
  method: AuthMethod;
}

/**
 * Why a verification failed. This is for server-side logging and metrics only —
 * clients always receive the same generic message so the API never reveals
 * whether an account exists.
 */
export type VerificationFailure =
  | 'UNKNOWN_IDENTIFIER'
  | 'BAD_CREDENTIAL'
  | 'NO_CREDENTIAL_SET'
  | 'ACCOUNT_INACTIVE';

export interface CredentialStrategy<TCredentials> {
  readonly method: AuthMethod;
  verify(credentials: TCredentials): Promise<VerificationResult>;
}
