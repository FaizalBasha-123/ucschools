import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';
import { backendUrl } from '@/lib/server/backend-url';

const log = createLogger('AdminSubscriptionStatsAPI');



export async function GET(request: NextRequest) {
  try {
    const backendRes = await fetch(`${backendUrl()}/api/admin/stats/subscriptions`, {
      method: 'GET',
      headers: authHeadersFrom(request),
      cache: 'no-store',
    });

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      log.error(`Backend subscription stats fetch failed: [${backendRes.status}] ${errorText}`);
      return apiError(
        'INTERNAL_ERROR',
        backendRes.status,
        'Failed to load admin subscription stats',
        errorText,
      );
    }

    const payload = await backendRes.json();
    return apiSuccess(payload);
  } catch (error) {
    log.error('Admin subscription stats proxy failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to load admin subscription stats',
      error instanceof Error ? error.message : String(error),
    );
  }
}
