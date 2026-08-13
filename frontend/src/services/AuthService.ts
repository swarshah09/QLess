import { apiRequest, ApiError } from '@/lib/api/client';
import { clearTokens, hasTokens, setTokens, type Tokens } from '@/lib/api/tokens';
import { readJSON, removeKey, writeJSON } from '@/lib/storage';
import type { User } from '@/types';

const KEY = 'qless.auth.user';
const GUEST_KEY = 'qless.auth.guest';

interface ApiUser {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
  role: 'USER' | 'STATION_OPERATOR' | 'ADMIN';
}

interface AuthResult {
  user: ApiUser;
  tokens: Tokens;
}

function mapUser(api: ApiUser): User {
  return {
    id: api.id,
    name: api.name,
    email: api.email ?? '',
    phone: api.phone ?? undefined,
  };
}

/** Role is kept alongside the cached user so operator/admin UI can gate on it. */
const ROLE_KEY = 'qless.auth.role';

export const AuthService = {
  async login(email: string, password: string): Promise<User> {
    const result = await apiRequest<AuthResult>('/auth/login', {
      method: 'POST',
      auth: false,
      body: { email, password },
    });

    setTokens(result.tokens);
    const user = mapUser(result.user);
    writeJSON(KEY, user);
    writeJSON(ROLE_KEY, result.user.role);
    removeKey(GUEST_KEY);
    return user;
  },

  async register(input: {
    name: string;
    email: string;
    password: string;
    phone?: string;
  }): Promise<User> {
    const result = await apiRequest<AuthResult>('/auth/register', {
      method: 'POST',
      auth: false,
      body: input,
    });

    setTokens(result.tokens);
    const user = mapUser(result.user);
    writeJSON(KEY, user);
    writeJSON(ROLE_KEY, result.user.role);
    removeKey(GUEST_KEY);
    return user;
  },

  async logout(): Promise<void> {
    try {
      // Best effort: the local session is cleared regardless, so a network
      // failure never leaves the user stuck signed in.
      await apiRequest<unknown>('/auth/logout', { method: 'POST', body: {} });
    } catch {
      /* ignore */
    }
    clearTokens();
    removeKey(KEY);
    removeKey(ROLE_KEY);
    removeKey(GUEST_KEY);
  },

  /** Re-reads the profile from the backend, refreshing the cached copy. */
  async refreshProfile(): Promise<User | null> {
    if (!hasTokens()) return null;
    try {
      const result = await apiRequest<{ user: ApiUser }>('/auth/me');
      const user = mapUser(result.user);
      writeJSON(KEY, user);
      writeJSON(ROLE_KEY, result.user.role);
      return user;
    } catch (error) {
      if (error instanceof ApiError && error.isAuthError) {
        clearTokens();
        removeKey(KEY);
        removeKey(ROLE_KEY);
      }
      return null;
    }
  },

  continueAsGuest(): void {
    writeJSON(GUEST_KEY, true);
  },

  isGuest(): boolean {
    return readJSON<boolean>(GUEST_KEY, false);
  },

  getCurrentUser(): User | null {
    if (!hasTokens()) return null;
    return readJSON<User | null>(KEY, null);
  },

  getRole(): 'USER' | 'STATION_OPERATOR' | 'ADMIN' | null {
    return readJSON<'USER' | 'STATION_OPERATOR' | 'ADMIN' | null>(ROLE_KEY, null);
  },

  isAuthenticated(): boolean {
    return this.getCurrentUser() !== null;
  },

  hasEntered(): boolean {
    return this.isAuthenticated() || this.isGuest();
  },

  /** Clears local session state without calling the backend. */
  clearLocalSession(): void {
    clearTokens();
    removeKey(KEY);
    removeKey(ROLE_KEY);
  },
};
