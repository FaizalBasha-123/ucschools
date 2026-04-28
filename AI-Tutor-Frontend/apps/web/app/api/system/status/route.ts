import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';

const log = createLogger('SystemStatusAPI');

function backendUrlBase(): string {
  return (
    process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL ||
    process.env.AI_TUTOR_API_BASE_URL ||
    'http://127.0.0.1:8099'
  );
}

export async function GET(request: NextRequest) {
  try {
    const backendRes = await fetch(`${backendUrlBase()}/api/system/status`, {
      method: 'GET',
      headers: authHeadersFrom(request),
      cache: 'no-store',
    });

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      log.error(`Backend system status fetch failed: [${backendRes.status}] ${errorText}`);
      return apiError('INTERNAL_ERROR', backendRes.status, 'Failed to load system status', errorText);
    }

    const payload = await backendRes.json();
    return apiSuccess(payload);
  } catch (error) {
    log.error('System status proxy failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to load system status',
      error instanceof Error ? error.message : String(error),
    );
  }
}
