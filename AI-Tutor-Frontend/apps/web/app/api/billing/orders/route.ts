import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';
import { backendUrl } from '@/lib/server/backend-url';

const log = createLogger('BillingOrdersAPI');



export async function GET(request: NextRequest) {
  try {
    const limit = request.nextUrl.searchParams.get('limit') || '50';
    const backendRes = await fetch(`${backendUrl()}/api/billing/orders?limit=${encodeURIComponent(limit)}`, {
      method: 'GET',
      headers: authHeadersFrom(request),
      cache: 'no-store',
    });

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      log.error(`Backend orders fetch failed: [${backendRes.status}] ${errorText}`);
      return apiError('INTERNAL_ERROR', backendRes.status, 'Failed to load payment orders', errorText);
    }

    const orders = await backendRes.json();
    return apiSuccess(orders);
  } catch (error) {
    log.error('Orders proxy failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to load payment orders',
      error instanceof Error ? error.message : String(error),
    );
  }
}
