import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';

const log = createLogger('LessonShelfAPI');

function backendUrlBase(): string {
  return (
    process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL ||
    process.env.AI_TUTOR_API_BASE_URL ||
    'http://127.0.0.1:8099'
  );
}

export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get('status');
    const limit = request.nextUrl.searchParams.get('limit') || '50';
    const url = new URL(`${backendUrlBase()}/api/lesson-shelf`);
    if (status) url.searchParams.set('status', status);
    url.searchParams.set('limit', limit);

    const backendRes = await fetch(url.toString(), {
      method: 'GET',
      headers: authHeadersFrom(request),
      cache: 'no-store',
    });

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      log.error(`Backend shelf fetch failed: [${backendRes.status}] ${errorText}`);
      return apiError('INTERNAL_ERROR', backendRes.status, 'Failed to load lesson shelf', errorText);
    }

    const data = await backendRes.json();
    return apiSuccess(data);
  } catch (error) {
    log.error('Lesson shelf proxy failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to load lesson shelf',
      error instanceof Error ? error.message : String(error),
    );
  }
}
