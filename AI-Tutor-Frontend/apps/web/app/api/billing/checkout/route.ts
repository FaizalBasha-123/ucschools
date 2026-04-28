import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';

const log = createLogger('BillingCheckoutAPI');

function backendUrlBase(): string {
  return (
    process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL ||
    process.env.AI_TUTOR_API_BASE_URL ||
    'http://127.0.0.1:8099'
  );
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const backendRes = await fetch(`${backendUrlBase()}/api/billing/checkout`, {
      method: 'POST',
      headers: {
        ...authHeadersFrom(request),
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      log.error(`Backend checkout failed: [${backendRes.status}] ${errorText}`);
      return apiError('INTERNAL_ERROR', backendRes.status, 'Checkout creation failed', errorText);
    }

    const session = await backendRes.json();
    return apiSuccess(session);
  } catch (error) {
    log.error('Checkout proxy failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Checkout creation failed',
      error instanceof Error ? error.message : String(error),
    );
  }
}
