import { type NextRequest } from 'next/server';

/**
 * Extract all necessary auth headers from an incoming NextRequest
 * to forward them to the backend.
 */
export function authHeadersFrom(request: NextRequest): HeadersInit {
  const headers: Record<string, string> = {};
  
  const authorization = request.headers.get('authorization');
  const xAuthToken = request.headers.get('x-auth-token');
  const xSessionToken = request.headers.get('x-session-token');
  const cookie = request.headers.get('cookie');
  
  if (authorization) headers.authorization = authorization;
  if (xAuthToken) headers['x-auth-token'] = xAuthToken;
  if (xSessionToken) headers['x-session-token'] = xSessionToken;
  if (cookie) headers.cookie = cookie;
  
  return headers;
}
