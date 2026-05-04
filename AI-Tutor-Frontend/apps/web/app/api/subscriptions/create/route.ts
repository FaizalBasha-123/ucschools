import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';
import { backendUrl } from '@/lib/server/backend-url';

const log = createLogger('SubscriptionsCreateAPI');



export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const backendRes = await fetch(`${backendUrl()}/api/subscriptions/create`, {
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
      log.error(`Backend subscription creation failed: [${backendRes.status}] ${errorText}`);
      return apiError('INTERNAL_ERROR', backendRes.status, 'Failed to create subscription', errorText);
    }

    const data = await backendRes.json();
    return apiSuccess(data);
  } catch (error) {
    log.error('Subscription creation proxy failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to create subscription',
      error instanceof Error ? error.message : String(error),
    );
  }
}
