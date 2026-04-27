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
  const headers: Record<string, string> = {};
  
  if (token) {
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

export async function verifyAuthSession(): Promise<boolean> {
  const token = getSessionToken();
  if (!token) return false;
  
  try {
    const response = await fetch('/api/subscriptions/me', {
      method: 'GET',
      cache: 'no-store',
      headers: authHeaders(),
      credentials: 'include',
    });
    return response.ok;
  } catch {
    return false;
  }
}
