import bcrypt from 'bcryptjs';
import { env } from '../config/env';

/**
 * Password hashing, isolated behind these two functions so the algorithm can be
 * swapped (or dropped entirely for OTP/magic-link auth) without touching the
 * services that call it.
 */

export async function hashPassword(plainText: string): Promise<string> {
  return bcrypt.hash(plainText, env.BCRYPT_ROUNDS);
}

export async function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainText, hash);
}

/**
 * A hash of a value that matches nothing. Used to spend the same CPU time on a
 * login for an unknown email as for a known one, so response timing does not
 * reveal whether an account exists.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.a1PZ5H0EFmuPUEwG3ZoUC5tXn1IU8pO';

/** Burns comparable CPU time when there is no real hash to check against. */
export async function fakeVerify(plainText: string): Promise<void> {
  await bcrypt.compare(plainText, DUMMY_HASH);
}
