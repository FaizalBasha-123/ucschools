import { Capacitor } from "@capacitor/core";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || "/api/v1").replace(/\/+$/, "");

interface FetchOptions extends RequestInit {
  headers?: Record<string, string>;
  _retryAfterRefresh?: boolean;
}

const STORAGE_KEYS = {
  TOKEN: "School24_token",
  REFRESH_TOKEN: "School24_refresh_token",
  REMEMBER: "School24_remember",
  USER: "School24_user",
  EXPIRY: "School24_token_expiry",
} as const;

const CSRF_COOKIE_NAME = "School24_csrf";
const CSRF_HEADER_NAME = "X-CSRF-Token";

const isNativeRuntime = (): boolean => {
  if (typeof window === "undefined") return false;
  if (Capacitor.isNativePlatform()) return true;
  return /Schools24App\//i.test(window.navigator.userAgent);
};

export const shouldUseCookieSession = (): boolean => {
  if (typeof window === "undefined") return false;
  if (isNativeRuntime()) return false;
  const host = window.location.hostname.toLowerCase();
  return host === "dash.schools24.in" || host === "forms.schools24.in";
};

type RefreshPayload = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  user?: {
    role?: string;
  };
};

let refreshPromise: Promise<boolean> | null = null;
let csrfPromise: Promise<string | null> | null = null;

const getAuthStorage = (): Storage => {
  if (typeof window === "undefined") return localStorage;
  if (isNativeRuntime()) return localStorage;
  const remembered = localStorage.getItem(STORAGE_KEYS.REMEMBER) === "true";
  return remembered ? localStorage : sessionStorage;
};

const notifyAuthExpired = (reason: string) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("app:auth-expired", { detail: { reason } }));
};

const setRoutingCookies = (role: string | undefined, expiresInSeconds: number) => {
  if (typeof document === "undefined") return;
  const maxAge = Math.max(0, Math.floor(Math.max(expiresInSeconds, 31536000)));
  document.cookie = `School24_session=1; path=/; max-age=${maxAge}; SameSite=Lax`;
  if (role) {
    document.cookie = `School24_role=${encodeURIComponent(role)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  }
};

const getStoredRefreshToken = (): string | null => {
  if (typeof window === "undefined") return null;
  return (
    getAuthStorage().getItem(STORAGE_KEYS.REFRESH_TOKEN) ||
    localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN) ||
    sessionStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN)
  );
};

const persistRefreshSession = (payload: RefreshPayload) => {
  if (typeof window === "undefined") return;
  const expiryTimestamp = Date.now() + (payload.expires_in * 1000);
  [localStorage, sessionStorage].forEach((storage) => {
    const hasSessionMarker =
      shouldUseCookieSession()
        ? !!storage.getItem(STORAGE_KEYS.USER)
        : !!storage.getItem(STORAGE_KEYS.TOKEN);

    if (hasSessionMarker) {
      // Keep an access-token fallback even on cookie-session hosts.
      // This prevents auth loops when browser/proxy drops auth cookies.
      storage.setItem(STORAGE_KEYS.TOKEN, payload.access_token);
      storage.setItem(STORAGE_KEYS.EXPIRY, expiryTimestamp.toString());
      if (payload.refresh_token) {
        storage.setItem(STORAGE_KEYS.REFRESH_TOKEN, payload.refresh_token);
      }
      if (payload.user) {
        const raw = storage.getItem(STORAGE_KEYS.USER);
        if (raw) {
          try {
            const current = JSON.parse(raw);
            storage.setItem(STORAGE_KEYS.USER, JSON.stringify({ ...current, ...payload.user }));
          } catch {
            // Ignore malformed cached user JSON and keep moving.
          }
        }
      }
    }
  });
  setRoutingCookies(payload.user?.role, payload.expires_in);
};

const readCookie = (name: string): string | null => {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!match) return null;
  return decodeURIComponent(match.slice(prefix.length));
};

const getCSRFTokenFromCookie = (): string | null => readCookie(CSRF_COOKIE_NAME);

const ensureCSRFToken = async (): Promise<string | null> => {
  if (!shouldUseCookieSession()) return null;
  const existing = getCSRFTokenFromCookie();
  if (existing) return existing;
  if (csrfPromise) return csrfPromise;

  csrfPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/csrf`, {
        method: "GET",
        credentials: "include",
      });
      if (!response.ok) return null;
      const payload = await response.json().catch(() => null as { csrf_token?: string } | null);
      return payload?.csrf_token || getCSRFTokenFromCookie();
    } catch {
      return null;
    } finally {
      csrfPromise = null;
    }
  })();

  return csrfPromise;
};

const attemptRefresh = async (): Promise<boolean> => {
  if (!shouldUseCookieSession()) return false;
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const csrfToken = getCSRFTokenFromCookie() || await ensureCSRFToken();
      const refreshToken = getStoredRefreshToken();
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
        },
        body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {}),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.warn("[auth][refresh] failed", response.status, detail || "no-body");
        if (response.status === 401 || response.status === 403) {
          notifyAuthExpired(`refresh_failed:${response.status}`);
        }
        return false;
      }

      const payload = (await response.json()) as RefreshPayload;
      if (!payload?.access_token || !payload?.expires_in) {
        return false;
      }
      persistRefreshSession(payload);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

// Custom error class for validation errors (won't trigger Next.js error overlay)
export class ValidationError extends Error {
  public readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

/**
 * Thrown when the device cannot reach the server at all.
 * Caused by: no WiFi, airplane mode, server unreachable, CORS pre-flight blocked.
 * Components can check `error instanceof NetworkError` to show an offline state
 * instead of a generic error message.
 */
export class NetworkError extends Error {
  constructor(message = 'No internet connection. Please check your network and try again.') {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Thrown for 5xx server-side failures.
 * Distinct from NetworkError (server replied but with an error) and
 * ValidationError (client sent bad data).
 */
export class ServerError extends Error {
  public readonly statusCode: number
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ServerError';
    this.statusCode = statusCode;
  }
}

/** Returns true when the error is a 4xx "no data" error (as opposed to a network failure) */
export function isNoDataError(err: unknown): boolean {
  return err instanceof ValidationError
}

/**
 * Decodes the JWT payload WITHOUT verifying the signature.
 * Used client-side only to inspect claims (session_id, exp, etc.) before
 * deciding whether to transmit the token.  Never used for authorisation.
 */
const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

async function fetchClient<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const token = typeof window !== "undefined"
    ? getAuthStorage().getItem(STORAGE_KEYS.TOKEN) || localStorage.getItem(STORAGE_KEYS.TOKEN) || sessionStorage.getItem(STORAGE_KEYS.TOKEN)
    : null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token) {
    // On cookie-session hosts the backend's TokenLookup checks the Authorization
    // header BEFORE the auth cookie.  If the stored token is a legacy token that
    // was issued before session-binding was introduced (i.e. no session_id claim)
    // it will always fail with "session-bound access token required" even though
    // the browser is sending a perfectly valid HTTP-only cookie.
    // Fix: only forward the bearer token on these hosts when it carries a
    // session_id claim; otherwise let the cookie handle auth and clear the stale
    // token from storage so it can't cause further failures.
    if (!shouldUseCookieSession()) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      const payload = decodeJwtPayload(token);
      if (payload?.session_id) {
        headers["Authorization"] = `Bearer ${token}`;
      } else {
        [localStorage, sessionStorage].forEach((s) => s.removeItem(STORAGE_KEYS.TOKEN));
      }
    }
  }

  const method = (options.method || "GET").toUpperCase();
  if (shouldUseCookieSession() && !["GET", "HEAD", "OPTIONS", "TRACE"].includes(method)) {
    const csrfToken = await ensureCSRFToken();
    if (csrfToken) {
      headers[CSRF_HEADER_NAME] = csrfToken;
    }
  }

  const config: RequestInit = {
    ...options,
    headers,
    credentials: options.credentials ?? (shouldUseCookieSession() ? "include" : "same-origin"),
  };

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

    // Handle 401 Unauthorized — attempt refresh for cookie sessions, then bubble up
    if (response.status === 401 && !endpoint.includes("/auth/login") && !endpoint.includes("/auth/refresh")) {
      const detail = await response.clone().text().catch(() => "");
      console.warn(`[auth][401] endpoint=${endpoint} status=401 detail=${detail || "no-body"}`);
      if (!options._retryAfterRefresh) {
        const refreshed = await attemptRefresh();
        if (refreshed) {
          return fetchClient<T>(endpoint, { ...options, _retryAfterRefresh: true });
        }
      }
      notifyAuthExpired(`unauthorized:${endpoint}`);
      throw new ValidationError("Session expired. Please login again.", "unauthorized");
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.message || errorData.error || `Error ${response.status}`;

      // Use ValidationError for 4xx errors (client/validation errors)
      if (response.status >= 400 && response.status < 500) {
        throw new ValidationError(errorMessage, errorData.error);
      }

      // Use ServerError for 5xx server errors
      throw new ServerError(errorMessage, response.status);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    // Only log unexpected errors (not validation/network errors which are handled by the UI)
    if (!(error instanceof ValidationError) && !(error instanceof NetworkError)) {
      console.error(`API Error [${endpoint}]:`, error);
    }
    // Detect network failure (no connection, DNS failure, CORS, etc.)
    // TypeError with "Failed to fetch" is the browser's signal that the request
    // never reached the server. Re-throw as a typed NetworkError so components
    // can distinguish "offline" from "server returned an error".
    if (error instanceof TypeError && /failed to fetch|network request failed|load failed/i.test(error.message)) {
      // Immediately signal the UI — don't wait for the browser's slow `offline` event.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('app:offline'));
      }
      throw new NetworkError();
    }
    throw error;
  }
}

async function fetchBinaryClient(endpoint: string, options: FetchOptions = {}): Promise<Blob> {
  const token = typeof window !== "undefined"
    ? getAuthStorage().getItem(STORAGE_KEYS.TOKEN) || localStorage.getItem(STORAGE_KEYS.TOKEN) || sessionStorage.getItem(STORAGE_KEYS.TOKEN)
    : null;
  const headers: Record<string, string> = {
    ...options.headers,
  };
  delete headers["Content-Type"];
  if (token) {
    if (!shouldUseCookieSession()) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      const payload = decodeJwtPayload(token);
      if (payload?.session_id) {
        headers["Authorization"] = `Bearer ${token}`;
      } else {
        [localStorage, sessionStorage].forEach((s) => s.removeItem(STORAGE_KEYS.TOKEN));
      }
    }
  }

  const method = (options.method || "GET").toUpperCase();
  if (shouldUseCookieSession() && !["GET", "HEAD", "OPTIONS", "TRACE"].includes(method)) {
    const csrfToken = await ensureCSRFToken();
    if (csrfToken) {
      headers[CSRF_HEADER_NAME] = csrfToken;
    }
  }

  const config: RequestInit = {
    ...options,
    headers,
    credentials: options.credentials ?? (shouldUseCookieSession() ? "include" : "same-origin"),
  };

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

    if (response.status === 401 && !endpoint.includes("/auth/login") && !endpoint.includes("/auth/refresh")) {
      if (!options._retryAfterRefresh) {
        const refreshed = await attemptRefresh();
        if (refreshed) {
          return fetchBinaryClient(endpoint, { ...options, _retryAfterRefresh: true });
        }
      }
      notifyAuthExpired(`unauthorized:${endpoint}`);
      throw new ValidationError("Session expired. Please login again.", "unauthorized");
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.message || errorData.error || `Error ${response.status}`;
      if (response.status >= 400 && response.status < 500) {
        throw new ValidationError(errorMessage, errorData.error);
      }
      throw new ServerError(errorMessage, response.status);
    }

    return await response.blob();
  } catch (error) {
    if (!(error instanceof ValidationError) && !(error instanceof NetworkError)) {
      console.error(`Binary API Error [${endpoint}]:`, error);
    }
    if (error instanceof TypeError && /failed to fetch|network request failed|load failed/i.test(error.message)) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('app:offline'));
      }
      throw new NetworkError();
    }
    throw error;
  }
}

async function fetchFormClient<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const token = typeof window !== "undefined" && !shouldUseCookieSession()
    ? getAuthStorage().getItem(STORAGE_KEYS.TOKEN) || localStorage.getItem(STORAGE_KEYS.TOKEN) || sessionStorage.getItem(STORAGE_KEYS.TOKEN)
    : null;
  const headers: Record<string, string> = {
    ...options.headers,
  };
  delete headers["Content-Type"];
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const method = (options.method || "POST").toUpperCase();
  if (shouldUseCookieSession() && !["GET", "HEAD", "OPTIONS", "TRACE"].includes(method)) {
    const csrfToken = await ensureCSRFToken();
    if (csrfToken) {
      headers[CSRF_HEADER_NAME] = csrfToken;
    }
  }

  const config: RequestInit = {
    ...options,
    headers,
    credentials: options.credentials ?? (shouldUseCookieSession() ? "include" : "same-origin"),
  };

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

    if (response.status === 401 && !endpoint.includes("/auth/login") && !endpoint.includes("/auth/refresh")) {
      if (!options._retryAfterRefresh) {
        const refreshed = await attemptRefresh();
        if (refreshed) {
          return fetchFormClient<T>(endpoint, { ...options, _retryAfterRefresh: true });
        }
      }
      notifyAuthExpired(`unauthorized:${endpoint}`);
      throw new ValidationError("Session expired. Please login again.", "unauthorized");
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.message || errorData.error || `Error ${response.status}`;
      if (response.status >= 400 && response.status < 500) {
        throw new ValidationError(errorMessage, errorData.error);
      }
      throw new ServerError(errorMessage, response.status);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return await response.json();
  } catch (error) {
    if (!(error instanceof ValidationError) && !(error instanceof NetworkError)) {
      console.error(`Form API Error [${endpoint}]:`, error);
    }
    if (error instanceof TypeError && /failed to fetch|network request failed|load failed/i.test(error.message)) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('app:offline'));
      }
      throw new NetworkError();
    }
    throw error;
  }
}

export const api = {
  get: <T>(endpoint: string, options?: FetchOptions) => fetchClient<T>(endpoint, { ...options, method: "GET" }),
  /** Like `get` but returns `fallback` on 404/400 instead of throwing. Network errors still propagate. */
  getOrEmpty: async <T>(endpoint: string, fallback: T, options?: FetchOptions): Promise<T> => {
    try {
      return await fetchClient<T>(endpoint, { ...options, method: "GET" })
    } catch (err) {
      if (err instanceof ValidationError) {
        return fallback
      }
      throw err
    }
  },
  post: <T>(endpoint: string, body: any, options?: FetchOptions) => fetchClient<T>(endpoint, { ...options, method: "POST", body: JSON.stringify(body) }),
  put: <T>(endpoint: string, body: any, options?: FetchOptions) => fetchClient<T>(endpoint, { ...options, method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(endpoint: string, options?: FetchOptions) => fetchClient<T>(endpoint, { ...options, method: "DELETE" }),
  patch: <T>(endpoint: string, body: any, options?: FetchOptions) => fetchClient<T>(endpoint, { ...options, method: "PATCH", body: JSON.stringify(body) }),
  fetchBlob: (endpoint: string, options?: FetchOptions) => fetchBinaryClient(endpoint, { ...options, method: options?.method || "GET" }),
  postForm: <T>(endpoint: string, body: FormData, options?: FetchOptions) => fetchFormClient<T>(endpoint, { ...options, method: "POST", body }),
  putForm: <T>(endpoint: string, body: FormData, options?: FetchOptions) => fetchFormClient<T>(endpoint, { ...options, method: "PUT", body }),
};
