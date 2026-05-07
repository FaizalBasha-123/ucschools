import { createLogger } from '@/lib/logger';

const log = createLogger('AuthSession');

const SESSION_TOKEN_KEY = 'aiTutorSessionToken';
const REFRESH_TOKEN_KEY = 'aiTutorRefreshToken';
const TOKEN_EXPIRES_AT_KEY = 'aiTutorTokenExpiresAt';
const ACCOUNT_EMAIL_KEY = 'aiTutorAccountEmail';
const ACCOUNT_ID_KEY = 'aiTutorAccountId';
export const OPERATOR_TOKEN_KEY = 'operatorBearerToken';

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
    // True tokens are substantial JWTs or opaque IDs, never short strings
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
    // no-op – storage may be unavailable in private mode
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

  if (extra) {
    if (!(extra instanceof Headers) && !Array.isArray(extra)) {
      Object.assign(headers, extra);
    }
  }

  return headers;
}

// ─── Token refresh ────────────────────────────────────────────────────────────

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
      log.warn('Refresh token rejected by backend (status %s) — session will be cleared', res.status);
      clearAuthSession();
      return false;
    }

    const data = await res.json();
    if (data.access_token) {
      setAuthSession({
        token: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        accountId:
          typeof window !== 'undefined'
            ? localStorage.getItem(ACCOUNT_ID_KEY) || undefined
            : undefined,
        email:
          typeof window !== 'undefined'
            ? localStorage.getItem(ACCOUNT_EMAIL_KEY) || undefined
            : undefined,
      });
      log.info('Token refreshed successfully');
      return true;
    }
    return false;
  } catch (err) {
    // Network failure during refresh — do NOT clear the session; just return false
    log.warn('Network error during token refresh, will retry on next request', err);
    return false;
  }
}

// ─── apiFetch ─────────────────────────────────────────────────────────────────

/**
 * Drop-in fetch wrapper that:
 * 1. Proactively refreshes the token if it's within 60s of expiry
 * 2. Retries once with a fresh token on a 401
 *
 * IMPORTANT: Does NOT clear the session on non-401 errors.
 * Only a confirmed 401 after a successful refresh attempt clears the session.
 */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = path.startsWith('/') ? path : `/${path}`;

  // Proactive refresh: if token expires within 60s (not 30s — more headroom on slow connections)
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

  // Reactive refresh: on 401, attempt one silent refresh then retry
  if (
    response.status === 401 &&
    typeof window !== 'undefined' &&
    localStorage.getItem(REFRESH_TOKEN_KEY)
  ) {
    log.warn('Got 401, attempting silent token refresh before retry');
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
 * Enterprise-grade session verification.
 *
 * Design decisions (matching industry patterns like Vercel, Linear, Notion):
 *
 * 1. LOCAL-FIRST: If a valid, non-expired token exists in localStorage, trust
 *    it immediately without a network call. The token was issued by the backend
 *    and its expiry is authoritative. This prevents any network latency from
 *    causing false logouts on page refresh.
 *
 * 2. BACKGROUND NETWORK CHECK: A lightweight network ping is fired after
 *    returning the local result. If the backend returns a definitive 401
 *    (token revoked server-side), the session is cleared and the window is
 *    reloaded to reflect the logged-out state.
 *
 * 3. NEVER CLEARS ON NETWORK FAILURE: A timeout, 5xx, or network error does
 *    NOT destroy the session. Only a backend-confirmed 401 does.
 *
 * 4. EXPIRED TOKEN → REFRESH: If the token has expired (per local expiry
 *    metadata), we attempt a silent refresh before giving up. If refresh
 *    succeeds the function returns true.
 *
 * @returns true if the user should be treated as authenticated, false if the
 *          session is definitively invalid and the user must log in again.
 */
export async function verifyAuthSession(): Promise<boolean> {
  const token = getSessionToken();
  if (!token) return false;

  // ── Step 1: Check local expiry ────────────────────────────────────────────
  if (typeof window !== 'undefined') {
    const expiresStr = localStorage.getItem(TOKEN_EXPIRES_AT_KEY);
    if (expiresStr) {
      const expiresAt = parseInt(expiresStr, 10);
      const secondsLeft = (expiresAt - Date.now()) / 1000;

      if (secondsLeft > 60) {
        // Token is fresh (more than 60s left). Trust it locally.
        // Fire a background check to detect server-side revocation, but
        // do NOT block the UI on it.
        pingSessionInBackground(token);
        return true;
      }

      if (secondsLeft <= 0) {
        // Token has expired. Attempt silent refresh.
        log.info('Token expired locally, attempting silent refresh');
        const refreshed = await executeTokenRefresh();
        if (refreshed) return true;
        // Refresh failed — session is gone
        return false;
      }

      // 0–60s window: token is about to expire. Attempt refresh proactively,
      // but use the local token as a fallback if refresh fails.
      if (!isRefreshing) {
        isRefreshing = true;
        refreshPromise = executeTokenRefresh().finally(() => {
          isRefreshing = false;
          refreshPromise = null;
        });
      }
      const refreshed = await refreshPromise;
      // Even if refresh fails, the token is still technically valid for up to
      // 60 more seconds — keep the session alive.
      return refreshed || true;
    }
  }

  // ── Step 2: No expiry metadata — token was set before expiresIn was stored.
  // Verify with the backend once using /api/lesson-shelf (lightweight, reader
  // role, always returns a small payload). We use this rather than
  // /api/subscriptions/me because subscriptions can return 403/404 for valid
  // users who simply have no active plan — that is NOT an auth failure.
  try {
    const response = await fetch('/api/lesson-shelf', {
      method: 'GET',
      headers: authHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });

    if (response.status === 401) {
      // Definitively invalid. Attempt one refresh before giving up.
      log.warn('Session returned 401 (no expiry metadata), attempting refresh');
      const refreshed = await executeTokenRefresh();
      return refreshed;
    }

    // Any other status (200, 403, 404, 5xx) means the token itself was accepted
    // by the auth middleware — do NOT log the user out.
    return true;
  } catch {
    // Network failure — preserve the session. User may be offline or the
    // backend may be starting up.
    log.warn('Network error during session verification, preserving local session');
    return true;
  }
}

/**
 * Fires a one-shot background ping to detect server-side token revocation.
 * Runs completely in the background — never blocks UI or causes redirects
 * directly. If a 401 is received, the session is cleared and the page is
 * reloaded so the user sees the login page naturally.
 */
function pingSessionInBackground(token: string): void {
  if (typeof window === 'undefined') return;

  // Small delay so we don't compete with the page's initial data fetches
  setTimeout(async () => {
    try {
      const res = await fetch('/api/lesson-shelf', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 401) {
        // Server-side revocation detected. Try refresh first.
        log.warn('[BG] Session revoked server-side, attempting refresh');
        const refreshed = await executeTokenRefresh();
        if (!refreshed) {
          log.warn('[BG] Refresh failed — clearing session and reloading');
          clearAuthSession();
          // Soft reload: redirect to the auth page rather than a hard reload
          // to avoid losing any form data. We use location.assign so the
          // back-button works correctly.
          window.location.assign('/auth?mode=signin&reason=session_expired');
        }
      }
    } catch {
      // Network error in background ping — do nothing, session is fine
    }
  }, 3000); // 3s delay — well after the page's first meaningful paint
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
