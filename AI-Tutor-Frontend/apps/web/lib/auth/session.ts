const SESSION_TOKEN_KEY = 'aiTutorSessionToken';
const ACCOUNT_EMAIL_KEY = 'aiTutorAccountEmail';
const ACCOUNT_ID_KEY = 'aiTutorAccountId';
const SESSION_ACTIVE_KEY = 'aiTutorSessionActive';

export type AuthSession = {
  token?: string;
  accountId?: string;
  email?: string;
};

function readStorageFlag(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function hasAuthSessionHint(): boolean {
  return !!getSessionToken() || readStorageFlag(SESSION_ACTIVE_KEY);
}

export function getSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = localStorage.getItem(SESSION_TOKEN_KEY);
    return token && token.trim().length > 0 ? token : null;
  } catch {
    return null;
  }
}

export function getAuthSession(): AuthSession | null {
  const token = getSessionToken();
  if (!token && !hasAuthSessionHint()) return null;
  if (typeof window === 'undefined') return token ? { token } : {};
  try {
    return {
      ...(token ? { token } : {}),
      accountId: localStorage.getItem(ACCOUNT_ID_KEY) || undefined,
      email: localStorage.getItem(ACCOUNT_EMAIL_KEY) || undefined,
    };
  } catch {
    return token ? { token } : {};
  }
}

export function setAuthSession(session: AuthSession): void {
  if (typeof window === 'undefined') return;
  try {
    if (session.token && session.token.trim().length > 0) {
      localStorage.setItem(SESSION_TOKEN_KEY, session.token);
    } else {
      localStorage.removeItem(SESSION_TOKEN_KEY);
    }
    localStorage.setItem(SESSION_ACTIVE_KEY, '1');
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
    localStorage.removeItem(SESSION_ACTIVE_KEY);
    localStorage.removeItem(ACCOUNT_ID_KEY);
    localStorage.removeItem(ACCOUNT_EMAIL_KEY);
  } catch {
    // no-op
  }
}

export function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getSessionToken();
  return {
    ...(extra || {}),
    ...(token ? { 
      Authorization: `Bearer ${token}`,
      'X-Auth-Token': token
    } : {}),
  };
}

export async function verifyAuthSession(): Promise<boolean> {
  const response = await fetch('/api/subscriptions/me', {
    method: 'GET',
    cache: 'no-store',
    headers: authHeaders(),
    credentials: 'include',
  });

  return response.ok;
}
