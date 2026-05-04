import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';
import { backendUrl } from '@/lib/server/backend-url';

const log = createLogger('LessonShelfReopenAPI');



export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const backendRes = await fetch(`${backendUrl()}/api/lesson-shelf/${encodeURIComponent(id)}/reopen`, {
      method: 'POST',
      headers: authHeadersFrom(request),
      cache: 'no-store',
    });

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      log.error(`Backend shelf reopen failed: [${backendRes.status}] ${errorText}`);
      return apiError('INTERNAL_ERROR', backendRes.status, 'Failed to reopen lesson shelf item', errorText);
    }

    const data = await backendRes.json();
    return apiSuccess(data);
  } catch (error) {
    log.error('Lesson shelf reopen proxy failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to reopen lesson shelf item',
      error instanceof Error ? error.message : String(error),
    );
  }
}
