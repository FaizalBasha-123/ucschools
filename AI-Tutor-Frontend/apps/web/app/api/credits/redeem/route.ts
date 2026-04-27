import { type NextRequest } from 'next/server';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';

const log = createLogger('CreditRedeemAPI');

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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { code?: string };
    const code = body?.code?.trim();

    if (!code) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Promo code is required');
    }

    const backendRes = await fetch(`${backendUrlBase()}/api/credits/redeem`, {
      method: 'POST',
      headers: {
        ...authHeadersFrom(request),
        'content-type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({ code }),
    });

    const responseText = await backendRes.text();

    if (!backendRes.ok) {
      log.error(`Backend promo redeem failed: [${backendRes.status}] ${responseText}`);
      return apiError('INTERNAL_ERROR', backendRes.status, 'Failed to redeem promo code', responseText);
    }

    return new Response(responseText, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    log.error('Promo redeem proxy failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to redeem promo code',
      error instanceof Error ? error.message : String(error),
    );
  }
}
