import { z } from 'zod';
import { uuidSchema } from './common.validators';

/**
 * Password policy. Length is the dominant factor in resistance to guessing, so
 * a generous minimum length is required rather than a character-class maze that
 * mostly produces `Password1!`.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  // bcrypt silently ignores input past 72 bytes; reject rather than truncate.
  .max(72, 'Password must be at most 72 characters');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Must be a valid email address')
  .max(255);

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, 'Must be a valid phone number')
  .optional();

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  // `role` is intentionally absent: self-registration always creates a USER and
  // any role sent by the client is ignored, not rejected-then-honoured.
});

export const loginSchema = z.object({
  email: emailSchema,
  // Not validated against the password policy — an existing password predating
  // a policy change must still be able to log in.
  password: z.string().min(1, 'Password is required').max(72),
});

/**
 * Refresh and logout accept the token in the body for native clients; web
 * clients send it as an httpOnly cookie and omit the field entirely.
 */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(500).optional(),
});

export const logoutSchema = refreshSchema;

export const userIdParamSchema = z.object({ userId: uuidSchema });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
