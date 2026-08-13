// Token storage.
//
// The backend rotates refresh tokens on every use, so the newest pair must
// always replace the previous one — never keep an old refresh token around.

const ACCESS_KEY = 'qless.auth.accessToken';
const REFRESH_KEY = 'qless.auth.refreshToken';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  tokenType?: string;
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

export function setTokens(tokens: Tokens): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACCESS_KEY, tokens.accessToken);
  window.localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function clearTokens(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}

export function hasTokens(): boolean {
  return getAccessToken() !== null;
}
