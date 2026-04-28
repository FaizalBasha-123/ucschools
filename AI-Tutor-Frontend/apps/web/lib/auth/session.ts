import { createLogger } from '@/lib/logger';

const log = createLogger('AuthSession');

const SESSION_TOKEN_KEY = 'aiTutorSessionToken';
const ACCOUNT_EMAIL_KEY = 'aiTutorAccountEmail';
const ACCOUNT_ID_KEY = 'aiTutorAccountId';

export type AuthSession = {
  token?: string;
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
    return {
      token,
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
    localStorage.removeItem(ACCOUNT_ID_KEY);
    localStorage.removeItem(ACCOUNT_EMAIL_KEY);
  } catch {
    // no-op
  }
}

export function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getSessionToken();
  const headers: Record<string, string> = {
    'X-Auth-Token': token || '',
    'X-Session-Token': token || '',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (extra) {
    if (!(extra instanceof Headers) && !Array.isArray(extra)) {
      Object.assign(headers, extra);
    }
  }

  return headers;
}

/**
 * Enterprise-grade fetch utility that bypasses the slow Vercel proxy 
 * when a direct backend URL is available.
 */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const apiBase = process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL || '';
  
  // Normalize path
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  
  // If we have a direct backend URL and the path starts with /api (but not internal next routes)
  // we hit the Rust backend directly.
  const isApiCall = cleanPath.startsWith('/api/') && !cleanPath.startsWith('/api/auth/callback');
  const url = (apiBase && isApiCall) 
    ? `${apiBase}${cleanPath}` 
    : cleanPath;

  const mergedOptions: RequestInit = {
    ...options,
    headers: authHeaders(options.headers),
  };

  return fetch(url, mergedOptions);
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
      log.warn('Session expired (401)');
      return false;
    }
    
    // If the server is down (5xx) or we have a network error, 
    // we assume the session is still valid locally to avoid frustrating the user.
    // Enterprises call this "Offline-first" or "Stale-While-Revalidate" auth.
    if (!response.ok && response.status >= 500) {
      log.warn(`Backend error (${response.status}), preserving local session`);
      return true;
    }

    return response.ok;
  } catch (err) {
    // If it's a network error (failed to fetch), don't sign the user out.
    // Only return false if we are sure the token is invalid.
    log.error('Network error during auth verification, preserving local session');
    return true; 
  }
}
