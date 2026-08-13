import { AuthMethod } from '@prisma/client';
import { userRepository } from '../../repositories/user.repository';
import { fakeVerify, verifyPassword } from '../../utils/password';
import type { CredentialStrategy, VerificationResult } from './strategy';

export interface PasswordCredentials {
  email: string;
  password: string;
}

/**
 * Email + password verification — the MVP strategy.
 *
 * Every failure path performs a bcrypt comparison of similar cost, so an
 * attacker cannot tell a non-existent account from a wrong password by timing
 * the response.
 */
export const passwordStrategy: CredentialStrategy<PasswordCredentials> = {
  method: AuthMethod.PASSWORD,

  async verify(credentials: PasswordCredentials): Promise<VerificationResult> {
    const user = await userRepository.findByEmailWithSecrets(credentials.email);

    if (!user) {
      await fakeVerify(credentials.password);
      return { ok: false, reason: 'UNKNOWN_IDENTIFIER' };
    }

    // A user created through an OTP/magic-link flow legitimately has no hash.
    if (!user.passwordHash) {
      await fakeVerify(credentials.password);
      return { ok: false, reason: 'NO_CREDENTIAL_SET' };
    }

    const matches = await verifyPassword(credentials.password, user.passwordHash);
    if (!matches) {
      return { ok: false, reason: 'BAD_CREDENTIAL' };
    }

    // Checked after the password so a deactivated account is not revealed to
    // someone who does not already know the password.
    if (!user.active) {
      return { ok: false, reason: 'ACCOUNT_INACTIVE' };
    }

    return { ok: true, identity: { user, method: AuthMethod.PASSWORD } };
  },
};
