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
    // Secure check: true tokens are substantial JWTs or IDs
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
    // no-op
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
  
  const headers: Record<string, string> = {
    'X-Auth-Token': token || '',
    'X-Session-Token': token || '',
  };
  
  // If an operator token exists, prioritize it for the Authorization header
  // as it is required for administrative routes.
  if (opToken) {
    headers['Authorization'] = `Bearer ${opToken}`;
    headers['X-Operator-Header'] = 'true';
    headers['X-Operator-Token'] = opToken;
  } else if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (extra) {
    if (!(extra instanceof Headers) && !Array.isArray(extra)) {
      Object.assign(headers, extra);
    }
  }

  return headers;
}

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function executeTokenRefresh(): Promise<boolean> {
  const refreshToken = typeof window !== 'undefined' ? localStorage.getItem(REFRESH_TOKEN_KEY) : null;
  if (!refreshToken) return false;

  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) {
      log.warn('Failed to refresh token, clearing session');
      clearAuthSession();
      return false;
    }

    const data = await res.json();
    if (data.access_token) {
      log.info('Successfully refreshed access token');
      setAuthSession({
        token: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        accountId: typeof window !== 'undefined' ? localStorage.getItem(ACCOUNT_ID_KEY) || undefined : undefined,
        email: typeof window !== 'undefined' ? localStorage.getItem(ACCOUNT_EMAIL_KEY) || undefined : undefined,
      });
      return true;
    }
    return false;
  } catch (err) {
    log.error('Network error during token refresh', err);
    return false;
  }
}

/**
 * Enterprise-grade fetch utility that uses Next.js proxying by default.
 * Direct backend bypass is disabled to avoid CORS issues when the 
 * frontend is on a different domain than the backend.
 * Now includes silent token refresh logic.
 */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = path.startsWith('/') ? path : `/${path}`;

  // Check expiration proactively if possible
  if (typeof window !== 'undefined') {
    const expiresStr = localStorage.getItem(TOKEN_EXPIRES_AT_KEY);
    if (expiresStr) {
      const expiresAt = parseInt(expiresStr, 10);
      // Refresh if expiring within the next 30 seconds
      if (Date.now() + 30000 > expiresAt) {
        if (!isRefreshing) {
          isRefreshing = true;
          refreshPromise = executeTokenRefresh().finally(() => {
            isRefreshing = false;
            refreshPromise = null;
          });
        }
        if (refreshPromise) {
          await refreshPromise;
        }
      }
    }
  }

  let mergedOptions: RequestInit = {
    ...options,
    headers: authHeaders(options.headers),
  };

  let response = await fetch(url, mergedOptions);

  // If we still got a 401, it might have expired exactly during the request
  if (response.status === 401 && typeof window !== 'undefined' && localStorage.getItem(REFRESH_TOKEN_KEY)) {
    log.warn('Got 401 on API call, attempting silent refresh');
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = executeTokenRefresh().finally(() => {
        isRefreshing = false;
        refreshPromise = null;
      });
    }
    const success = await refreshPromise;
    if (success) {
      // Retry request with new token
      mergedOptions = {
        ...options,
        headers: authHeaders(options.headers),
      };
      response = await fetch(url, mergedOptions);
    }
  }

  return response;
}

export async function verifyAuthSession(): Promise<boolean> {
  const token = getSessionToken();
  if (!token) return false;
  
  try {
    const response = await apiFetch('/api/subscriptions/me', {
      method: 'GET',
      cache: 'no-store',
      // Short timeout to avoid blocking the UI
      signal: AbortController ? AbortSignal.timeout(5000) : undefined,
    } as any);

    if (response.status === 401) {
      log.warn('Session is definitively expired (401) and refresh failed. User must log in again.');
      clearAuthSession();
      return false;
    }
    
    // If the server is down (5xx) or we have a network error, 
    // we assume the session is still valid locally to avoid frustrating the user.
    if (!response.ok && response.status >= 500) {
      log.warn(`Backend error (${response.status}), preserving local session`);
      return true;
    }

    return response.ok;
  } catch (err) {
    log.error('Network error during auth verification, preserving local session');
    return true; 
  }
}

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
      headers: { 'X-Operator-Header': 'true' } 
    });
  } catch (e) {
    // ignore network errors on signout
  } finally {
    clearOperatorSession();
  }
}
