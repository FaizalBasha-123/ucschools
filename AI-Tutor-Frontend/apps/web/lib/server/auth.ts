import { type NextRequest } from 'next/server';

/**
 * Static API token for routes that require ApiRole::Reader or higher.
 * Set AI_TUTOR_INTERNAL_API_TOKEN in Next.js server env (Vercel env vars).
 * Value must match one of the tokens in AI_TUTOR_API_TOKENS on the backend.
 */
function internalApiToken(): string | null {
  return process.env.AI_TUTOR_INTERNAL_API_TOKEN ?? null;
}

/**
 * Backend auth middleware has two distinct auth paths:
 *
 * PATH A — session_auth_required routes (e.g. GET /api/lesson-shelf, /api/billing/dashboard):
 *   required_role_for_request returns None → role check skipped entirely.
 *   BUT session_auth_required check runs → requires AuthenticatedAccountContext (from user JWT).
 *   extract_session_token reads Authorization: Bearer FIRST (early return if present).
 *   → For these routes we MUST put the user JWT in Authorization: Bearer.
 *     No static token needed or wanted here.
 *
 * PATH B — role-required routes that also accept an account context (e.g. some POST routes):
 *   required_role_for_request returns Reader/Writer → static token goes in Authorization: Bearer.
 *   extract_account_id tries Authorization: Bearer (static token fails JWT verify → None),
 *   then tries ai_tutor_session cookie (user JWT → success).
 *   → Static token in Authorization + user JWT in cookie.
 *
 * SESSION-AUTH ROUTES (PATH A):
 *   /api/lesson-shelf, /api/lesson-shelf/*, /api/lessons/*, /api/billing/*, /api/credits/*
 *
 * ROLE-REQUIRED ROUTES (PATH B):
 *   Everything else that needs ApiRole (Reader/Writer).
 *
 * Strategy:
 *   - Check if the requested path is session_auth_required (PATH A) → forward user JWT as Authorization
 *   - Otherwise (PATH B) → inject static token as Authorization, user JWT as cookie
 */
function isSessionAuthRequired(pathname: string): boolean {
  return (
    pathname === '/api/lesson-shelf' ||
    pathname === '/api/lesson-shelf/mark-opened' ||
    pathname.startsWith('/api/lesson-shelf/') ||
    pathname.startsWith('/api/lessons/') ||
    pathname.startsWith('/api/billing/') ||
    pathname.startsWith('/api/credits/') ||
    pathname.startsWith('/api/subscriptions/') ||
    pathname.startsWith('/api/runtime/') ||
    pathname.startsWith('/api/schools/')
  );
}

/**
 * Session cookie name used by the Rust backend for extract_session_token fallback.
 * Must match AI_TUTOR_SESSION_COOKIE_NAME env on the backend (default: "ai_tutor_session").
 */
const SESSION_COOKIE_NAME =
  process.env.AI_TUTOR_SESSION_COOKIE_NAME ?? 'ai_tutor_session';

/**
 * Extract the user's JWT from the incoming browser request.
 * The browser sends it as "Authorization: Bearer <jwt>" via authHeaders().
 */
function extractUserJwt(request: NextRequest): string | null {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    return token.length > 0 ? token : null;
  }
  return null;
}

/**
 * Build headers to forward from a Next.js API route proxy to the Rust backend.
 *
 * Correctly handles both auth paths in the backend middleware so that:
 * 1. The user's account is always resolved (no "api-token:anonymous" fallback).
 * 2. The required role (Reader/Writer) is always granted.
 * 3. No 401 or 500 errors from missing or misplaced auth tokens.
 */
export function authHeadersFrom(request: NextRequest): HeadersInit {
  const headers: Record<string, string> = {};
  const apiToken = internalApiToken();
  const userJwt = extractUserJwt(request);

  // Determine which backend auth path this request hits
  const pathname = request.nextUrl.pathname;
  // Strip the /api prefix used by Next.js to get the backend path
  // e.g. /api/lesson-shelf → /api/lesson-shelf (same, since backend also uses /api/ prefix)
  const backendPath = pathname;

  if (isSessionAuthRequired(backendPath)) {
    // PATH A: Session-authenticated route.
    // Backend skips role check; only checks for user JWT in Authorization: Bearer.
    // Forward the user JWT directly — this is the ONLY thing that works here.
    if (userJwt) {
      headers['Authorization'] = `Bearer ${userJwt}`;
    }
    // Also forward existing cookies in case the backend session cookie was set server-side
    const cookie = request.headers.get('cookie');
    if (cookie) headers['Cookie'] = cookie;
  } else if (apiToken) {
    // PATH B: Role-required route with static token for role grant.
    // Static token → Authorization for role check.
    // User JWT → session cookie for account identity resolution.
    headers['Authorization'] = `Bearer ${apiToken}`;

    if (userJwt) {
      const existingCookie = request.headers.get('cookie') ?? '';
      const sessionEntry = `${SESSION_COOKIE_NAME}=${userJwt}`;
      headers['Cookie'] = existingCookie
        ? `${sessionEntry}; ${existingCookie}`
        : sessionEntry;
    } else {
      const cookie = request.headers.get('cookie');
      if (cookie) headers['Cookie'] = cookie;
    }
  } else {
    // Dev / auth disabled: forward everything as-is
    const authorization = request.headers.get('authorization');
    const cookie = request.headers.get('cookie');
    if (authorization) headers['Authorization'] = authorization;
    if (cookie) headers['Cookie'] = cookie;
  }

  return headers;
}
