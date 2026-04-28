import { type NextRequest } from 'next/server';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';

const log = createLogger('CreditRedeemAPI');

function backendUrlBase(): string {
  return (
    process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL ||
    process.env.AI_TUTOR_API_BASE_URL ||
    'http://127.0.0.1:8099'
  );
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
