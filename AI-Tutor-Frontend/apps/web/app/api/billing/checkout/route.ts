import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';
import { backendUrl } from '@/lib/server/backend-url';

const log = createLogger('BillingCheckoutAPI');



export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const backendRes = await fetch(`${backendUrl()}/api/billing/checkout`, {
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
