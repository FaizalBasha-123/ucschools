import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';

const log = createLogger('BillingDashboardAPI');

function backendUrlBase(): string {
  return (
    process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL ||
    process.env.AI_TUTOR_API_BASE_URL ||
    'http://127.0.0.1:8099'
  );
}

function authHeadersFrom(request: NextRequest): HeadersInit {
  const headers: Record<string, string> = {};
  const authorization = request.headers.get('authorization');
  const cookie = request.headers.get('cookie');
  const xAuthToken = request.headers.get('x-auth-token');
  const xSessionToken = request.headers.get('x-session-token');

  if (authorization) headers.authorization = authorization;
  if (cookie) headers.cookie = cookie;
  if (xAuthToken) headers['x-auth-token'] = xAuthToken;
  if (xSessionToken) headers['x-session-token'] = xSessionToken;
  
  return headers;
}

export async function GET(request: NextRequest) {
  try {
    const backendRes = await fetch(`${backendUrlBase()}/api/billing/dashboard`, {
      method: 'GET',
      headers: authHeadersFrom(request),
      cache: 'no-store',
    });

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      log.error(`Backend dashboard fetch failed: [${backendRes.status}] ${errorText}`);
      return apiError('INTERNAL_ERROR', backendRes.status, 'Failed to load billing dashboard', errorText);
    }

    const payload = await backendRes.json();
    return apiSuccess(payload);
  } catch (error) {
    log.error('Dashboard proxy failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to load billing dashboard',
      error instanceof Error ? error.message : String(error),
    );
  }
}
