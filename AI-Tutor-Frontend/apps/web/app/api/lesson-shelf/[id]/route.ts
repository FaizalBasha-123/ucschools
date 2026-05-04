import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';
import { backendUrl } from '@/lib/server/backend-url';

const log = createLogger('LessonShelfItemAPI');



export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const payload = await request.json();
    const backendRes = await fetch(`${backendUrl()}/api/lesson-shelf/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        ...authHeadersFrom(request),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      log.error(`Backend shelf patch failed: [${backendRes.status}] ${errorText}`);
      return apiError('INTERNAL_ERROR', backendRes.status, 'Failed to update lesson shelf item', errorText);
    }

    const data = await backendRes.json();
    return apiSuccess(data);
  } catch (error) {
    log.error('Lesson shelf patch proxy failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to update lesson shelf item',
      error instanceof Error ? error.message : String(error),
    );
  }
}
