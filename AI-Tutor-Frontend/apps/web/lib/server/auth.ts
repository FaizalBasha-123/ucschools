import { type NextRequest } from 'next/server';

/**
 * Session cookie name used by the Rust backend to extract the user's JWT.
 * Must match AI_TUTOR_SESSION_COOKIE_NAME on the backend (defaults to "ai_tutor_session").
 */
const SESSION_COOKIE_NAME =
  process.env.AI_TUTOR_SESSION_COOKIE_NAME ?? 'ai_tutor_session';

/**
 * The backend static API token used for role-based auth (ApiRole::Reader / Writer).
 * Set AI_TUTOR_INTERNAL_API_TOKEN in the Next.js server env to the first token
 * from the backend's AI_TUTOR_API_TOKENS env (any reader or writer token works).
 *
 * If not set, the proxy falls back to forwarding the client's Authorization header
 * unchanged (works when auth is disabled on the backend, e.g. local dev without tokens).
 */
function internalApiToken(): string | null {
  return process.env.AI_TUTOR_INTERNAL_API_TOKEN ?? null;
}

/**
 * Build the headers to forward from a Next.js API route to the Rust backend.
 *
 * Two-layer auth model (matching the backend middleware):
 *
 * 1. Role grant (ApiRole::Reader / Writer):
 *    The backend checks `Authorization: Bearer <token>` against `auth.tokens`
 *    (the static API tokens from AI_TUTOR_API_TOKENS). We inject the server-side
 *    AI_TUTOR_INTERNAL_API_TOKEN here so every proxied request has a valid role.
 *
 * 2. Account identity (extract_account_id):
 *    The backend's `extract_session_token` reads `Authorization: Bearer` first,
 *    then falls back to the `ai_tutor_session` cookie. Since we're now using the
 *    static API token in Authorization, we forward the user's JWT in the session
 *    cookie so `extract_account_id` can still resolve the correct account context.
 *
 * When AI_TUTOR_INTERNAL_API_TOKEN is not configured (local dev with auth disabled),
 * we fall back to forwarding the client's own Authorization header — this keeps
 * development working without any env configuration.
 */
export function authHeadersFrom(request: NextRequest): HeadersInit {
  const headers: Record<string, string> = {};

  const apiToken = internalApiToken();

  if (apiToken) {
    // Production: inject the static API token for role grant
    headers['Authorization'] = `Bearer ${apiToken}`;

    // Extract the user's JWT from the incoming request (sent by the browser
    // as Authorization: Bearer <jwt> via authHeaders() on the client)
    const incomingAuth = request.headers.get('authorization');
    const userJwt = incomingAuth?.startsWith('Bearer ')
      ? incomingAuth.slice('Bearer '.length).trim()
      : null;

    if (userJwt) {
      // Forward the user JWT as the session cookie so extract_account_id
      // can resolve the account_id from it
      const existingCookie = request.headers.get('cookie') ?? '';
      // Prepend our session cookie; existing cookies are preserved
      const sessionCookieEntry = `${SESSION_COOKIE_NAME}=${userJwt}`;
      headers['Cookie'] = existingCookie
        ? `${sessionCookieEntry}; ${existingCookie}`
        : sessionCookieEntry;
    }
  } else {
    // Dev / auth-disabled: forward client headers as-is
    const authorization = request.headers.get('authorization');
    const xAuthToken = request.headers.get('x-auth-token');
    const xSessionToken = request.headers.get('x-session-token');
    const cookie = request.headers.get('cookie');

    if (authorization) headers['Authorization'] = authorization;
    if (xAuthToken) headers['X-Auth-Token'] = xAuthToken;
    if (xSessionToken) headers['X-Session-Token'] = xSessionToken;
    if (cookie) headers['Cookie'] = cookie;
  }

  return headers;
}
