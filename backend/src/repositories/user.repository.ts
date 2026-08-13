import type { Prisma, User, UserRole } from '@prisma/client';
import { prisma } from '../config/prisma';

/** Columns safe to return to clients — never includes `passwordHash`. */
export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  active: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

/** Emails are stored and compared lowercased so logins are case-insensitive. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const userRepository = {
  /** Full record including the password hash — for credential checks only. */
  async findByEmailWithSecrets(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  },

  async findById(id: string): Promise<PublicUser | null> {
    return prisma.user.findUnique({ where: { id }, select: publicUserSelect });
  },

  /**
   * Minimal record for request authentication. Read fresh on every request so a
   * deactivated or role-changed user cannot keep acting on a stale token.
   */
  async findAuthContextById(
    id: string,
  ): Promise<{ id: string; name: string; email: string | null; role: UserRole; active: boolean } | null> {
    return prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, active: true },
    });
  },

  async existsByEmail(email: string): Promise<boolean> {
    const found = await prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: { id: true },
    });
    return found !== null;
  },

  async create(data: {
    name: string;
    email: string;
    phone?: string | null;
    passwordHash: string;
    role?: UserRole;
  }): Promise<PublicUser> {
    return prisma.user.create({
      data: {
        name: data.name,
        email: normalizeEmail(data.email),
        phone: data.phone ?? null,
        passwordHash: data.passwordHash,
        // Role is never taken from client input; callers pass it explicitly and
        // only the admin surface is allowed to choose anything but USER.
        role: data.role ?? 'USER',
      },
      select: publicUserSelect,
    });
  },

  async touchLastLogin(id: string): Promise<void> {
    await prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  },

  async listPaginated(params: {
    skip: number;
    take: number;
    role?: UserRole;
  }): Promise<{ items: PublicUser[]; total: number }> {
    const where: Prisma.UserWhereInput = params.role ? { role: params.role } : {};

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: publicUserSelect,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.user.count({ where }),
    ]);

    return { items, total };
  },

  async updateRole(id: string, role: UserRole): Promise<PublicUser> {
    return prisma.user.update({ where: { id }, data: { role }, select: publicUserSelect });
  },

  async setActive(id: string, active: boolean): Promise<PublicUser> {
    return prisma.user.update({ where: { id }, data: { active }, select: publicUserSelect });
  },
};
