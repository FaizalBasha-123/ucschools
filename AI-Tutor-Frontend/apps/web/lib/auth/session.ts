import { createLogger } from '@/lib/logger';

const log = createLogger('AuthSession');

const SESSION_TOKEN_KEY = 'aiTutorSessionToken';
const REFRESH_TOKEN_KEY = 'aiTutorRefreshToken';
const TOKEN_EXPIRES_AT_KEY = 'aiTutorTokenExpiresAt';
const ACCOUNT_EMAIL_KEY = 'aiTutorAccountEmail';
const ACCOUNT_ID_KEY = 'aiTutorAccountId';
export const OPERATOR_TOKEN_KEY = 'operatorBearerToken';

// Default TTL assumed for tokens that have no expiry metadata stored (legacy sessions).
// 24 hours is conservative — the backend will 401 any real request if the token
// is actually expired, and apiFetch() will attempt a refresh at that point.
const ASSUMED_TTL_SECONDS = 24 * 60 * 60;

export type AuthSession = {
  token?: string;
  refreshToken?: string;
  expiresIn?: number;
  accountId?: string;
  email?: string;
};

export function getSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = localStorage.getItem(SESSION_TOKEN_KEY);
    return token && token.trim().length > 10 ? token : null;
  } catch {
    return null;
  }
}

export function hasAuthSessionHint(): boolean {
  return !!getSessionToken();
}

export function getAuthSession(): AuthSession | null {
  const token = getSessionToken();
  if (!token) return null;
  try {
    const expiresStr = localStorage.getItem(TOKEN_EXPIRES_AT_KEY);
    let expiresIn: number | undefined;
    if (expiresStr) {
      const expiresAt = parseInt(expiresStr, 10);
      expiresIn = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
    }
    return {
      token,
      refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY) || undefined,
      expiresIn,
      accountId: localStorage.getItem(ACCOUNT_ID_KEY) || undefined,
      email: localStorage.getItem(ACCOUNT_EMAIL_KEY) || undefined,
    };
  } catch {
    return { token };
  }
}

export function setAuthSession(session: AuthSession): void {
  if (typeof window === 'undefined') return;
  try {
    if (session.token && session.token.trim().length > 10) {
      localStorage.setItem(SESSION_TOKEN_KEY, session.token);
    } else {
      localStorage.removeItem(SESSION_TOKEN_KEY);
    }
    if (session.refreshToken) {
      localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
    } else {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
    if (session.expiresIn) {
      const expiresAt = Date.now() + session.expiresIn * 1000;
      localStorage.setItem(TOKEN_EXPIRES_AT_KEY, expiresAt.toString());
    } else {
      localStorage.removeItem(TOKEN_EXPIRES_AT_KEY);
    }
    if (session.accountId) localStorage.setItem(ACCOUNT_ID_KEY, session.accountId);
    if (session.email) localStorage.setItem(ACCOUNT_EMAIL_KEY, session.email);
  } catch {
    // storage may be unavailable in private mode
  }
}

export function clearAuthSession(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRES_AT_KEY);
    localStorage.removeItem(ACCOUNT_ID_KEY);
    localStorage.removeItem(ACCOUNT_EMAIL_KEY);
  } catch {
    // no-op
  }
}

export function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getSessionToken();
  const opToken = getOperatorToken();
  const headers: Record<string, string> = {};

  if (opToken) {
    headers['Authorization'] = `Bearer ${opToken}`;
    headers['X-Operator-Header'] = 'true';
    headers['X-Operator-Token'] = opToken;
  } else if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['X-Auth-Token'] = token;
    headers['X-Session-Token'] = token;
  }

  if (extra && !(extra instanceof Headers) && !Array.isArray(extra)) {
    Object.assign(headers, extra);
  }

  return headers;
}

// ─── Token refresh (singleton) ────────────────────────────────────────────────

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function executeTokenRefresh(): Promise<boolean> {
  const refreshToken =
    typeof window !== 'undefined' ? localStorage.getItem(REFRESH_TOKEN_KEY) : null;
  if (!refreshToken) return false;

  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) {
      // Backend definitively rejected the refresh token — session is dead
      clearAuthSession();
      return false;
    }

    const data = await res.json();
    if (data.access_token) {
      setAuthSession({
        token: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        accountId: localStorage.getItem(ACCOUNT_ID_KEY) || undefined,
        email: localStorage.getItem(ACCOUNT_EMAIL_KEY) || undefined,
      });
      return true;
    }
    return false;
  } catch {
    // Network error during refresh — do NOT clear session; try again later
    return false;
  }
}

// ─── apiFetch ─────────────────────────────────────────────────────────────────

/**
 * Fetch wrapper with proactive + reactive token refresh.
 * This is the ONLY place where 401 responses trigger session cleanup.
 */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = path.startsWith('/') ? path : `/${path}`;

  // Proactively refresh if token expires within 60s
  if (typeof window !== 'undefined') {
    const expiresStr = localStorage.getItem(TOKEN_EXPIRES_AT_KEY);
    if (expiresStr) {
      const expiresAt = parseInt(expiresStr, 10);
      if (Date.now() + 60_000 > expiresAt) {
        if (!isRefreshing) {
          isRefreshing = true;
          refreshPromise = executeTokenRefresh().finally(() => {
            isRefreshing = false;
            refreshPromise = null;
          });
        }
        if (refreshPromise) await refreshPromise;
      }
    }
  }

  let mergedOptions: RequestInit = {
    ...options,
    headers: authHeaders(options.headers),
  };

  let response = await fetch(url, mergedOptions);

  // Reactive: on 401 attempt one silent refresh then retry
  if (
    response.status === 401 &&
    typeof window !== 'undefined' &&
    localStorage.getItem(REFRESH_TOKEN_KEY)
  ) {
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = executeTokenRefresh().finally(() => {
        isRefreshing = false;
        refreshPromise = null;
      });
    }
    const success = await refreshPromise;
    if (success) {
      mergedOptions = { ...options, headers: authHeaders(options.headers) };
      response = await fetch(url, mergedOptions);
    }
  }

  return response;
}

// ─── verifyAuthSession ────────────────────────────────────────────────────────

/**
 * Determines if the current user is authenticated. Designed to NEVER cause
 * false logouts on page refresh.
 *
 * Strategy (local-first, no background pings):
 *
 * 1. No token in localStorage → false (user definitely not logged in).
 *
 * 2. Token exists + expiresAt > 60s from now → RETURN TRUE immediately.
 *    No network call. The token is authoritative. If the backend has revoked
 *    it server-side, the next real API call via apiFetch() will 401 and
 *    trigger a silent refresh. We do NOT fire a background ping because:
 *    - The ping endpoint (lesson-shelf) requires static API tokens on
 *      production, not user JWTs → always returns 401 → false logout loop.
 *    - Background processes calling window.location.assign() create races.
 *
 * 3. Token exists + expiresAt within 60s → proactive refresh. If refresh
 *    fails, the old token is still valid for up to 60s — return true.
 *
 * 4. Token exists + already expired → attempt refresh. If refresh fails → false.
 *
 * 5. Token exists but NO expiresAt metadata (old session set before this was
 *    stored) → assume valid, write a 24h expiry so future calls hit path 2/3/4,
 *    and return true. The real expiry is enforced by the backend on the next
 *    data fetch via apiFetch(). Never make an extra network call just for this.
 */
export async function verifyAuthSession(): Promise<boolean> {
  const token = getSessionToken();
  if (!token) return false;

  if (typeof window === 'undefined') return true;

  const expiresStr = localStorage.getItem(TOKEN_EXPIRES_AT_KEY);

  // ── Case 5: No expiry metadata (legacy token) ─────────────────────────────
  if (!expiresStr) {
    // Write an assumed expiry so future refreshes of this page hit the normal
    // path. Backend will 401 the next real API call if the token is truly dead.
    const assumedExpiresAt = Date.now() + ASSUMED_TTL_SECONDS * 1000;
    try {
      localStorage.setItem(TOKEN_EXPIRES_AT_KEY, assumedExpiresAt.toString());
    } catch { /* ignore */ }
    return true;
  }

  const expiresAt = parseInt(expiresStr, 10);
  const secondsLeft = (expiresAt - Date.now()) / 1000;

  // ── Case 2: Token is fresh ────────────────────────────────────────────────
  if (secondsLeft > 60) {
    return true; // Trust it. No network call, no background ping.
  }

  // ── Case 4: Token already expired ────────────────────────────────────────
  if (secondsLeft <= 0) {
    log.info('Token expired, attempting silent refresh');
    const refreshed = await executeTokenRefresh();
    return refreshed;
  }

  // ── Case 3: Token expiring soon (0–60s left) ─────────────────────────────
  if (!isRefreshing) {
    isRefreshing = true;
    refreshPromise = executeTokenRefresh().finally(() => {
      isRefreshing = false;
      refreshPromise = null;
    });
  }
  // Even if refresh fails, the token is still valid for a bit — keep session.
  await refreshPromise;
  return true;
}

// ─── Operator helpers ─────────────────────────────────────────────────────────

export function getOperatorToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(OPERATOR_TOKEN_KEY);
}

export function clearOperatorSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(OPERATOR_TOKEN_KEY);
}

export async function operatorSignOut(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await fetch('/api/operator/auth/logout', {
      method: 'POST',
      headers: { 'X-Operator-Header': 'true' },
    });
  } catch {
    // ignore network errors on signout
  } finally {
    clearOperatorSession();
  }
}
