import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';

const log = createLogger('LessonShelfRetryAPI');

function backendUrlBase(): string {
  return (
    process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL ||
    process.env.AI_TUTOR_API_BASE_URL ||
    'http://127.0.0.1:8099'
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const backendRes = await fetch(`${backendUrlBase()}/api/lesson-shelf/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
      headers: {
        ...authHeadersFrom(request),
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      log.error(`Backend shelf retry failed: [${backendRes.status}] ${errorText}`);
      return apiError('INTERNAL_ERROR', backendRes.status, 'Failed to retry lesson shelf item', errorText);
    }

    const data = await backendRes.json();
    return apiSuccess(data);
  } catch (error) {
    log.error('Lesson shelf retry proxy failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to retry lesson shelf item',
      error instanceof Error ? error.message : String(error),
    );
  }
}