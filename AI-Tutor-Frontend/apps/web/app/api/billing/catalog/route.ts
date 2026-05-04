import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';
import { backendUrl } from '@/lib/server/backend-url';

const log = createLogger('BillingCatalogAPI');



export async function GET(request: NextRequest) {
  try {
    const backendRes = await fetch(`${backendUrl()}/api/billing/catalog`, {
      method: 'GET',
      headers: authHeadersFrom(request),
      cache: 'no-store',
    });

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      log.error(`Backend catalog fetch failed: [${backendRes.status}] ${errorText}`);
      return apiError('INTERNAL_ERROR', backendRes.status, 'Failed to load billing catalog', errorText);
    }

    const catalog = await backendRes.json();
    return apiSuccess(catalog);
  } catch (error) {
    log.error('Catalog proxy failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to load billing catalog',
      error instanceof Error ? error.message : String(error),
    );
  }
}
