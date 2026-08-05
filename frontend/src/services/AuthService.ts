import { MOCK_USER } from '@/mocks';
import { delay, readJSON, removeKey, writeJSON } from '@/lib/storage';
import type { User } from '@/types';

const KEY = 'qless.auth.user';
const GUEST_KEY = 'qless.auth.guest';

// Mock auth: any email/password is accepted and the session is stored locally.
export const AuthService = {
  async login(email: string, _password: string): Promise<User> {
    const user: User = { ...MOCK_USER, email: email || MOCK_USER.email };
    writeJSON(KEY, user);
    removeKey(GUEST_KEY);
    return delay(user, 400);
  },

  async logout(): Promise<void> {
    removeKey(KEY);
    removeKey(GUEST_KEY);
    return delay(undefined, 150);
  },

  continueAsGuest(): void {
    writeJSON(GUEST_KEY, true);
  },

  isGuest(): boolean {
    return readJSON<boolean>(GUEST_KEY, false);
  },

  getCurrentUser(): User | null {
    return readJSON<User | null>(KEY, null);
  },

  isAuthenticated(): boolean {
    return this.getCurrentUser() !== null;
  },

  // A returning user (authenticated or guest) skips the landing page.
  hasEntered(): boolean {
    return this.isAuthenticated() || this.isGuest();
  },
};
