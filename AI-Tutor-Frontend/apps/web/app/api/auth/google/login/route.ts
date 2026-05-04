import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { backendUrl } from '@/lib/server/backend-url';



export async function GET(request: NextRequest) {
  try {
    const backendRes = await fetch(`${backendUrl()}/api/auth/google/login`, {
      method: 'GET',
      headers: {
        cookie: request.headers.get('cookie') || '',
      },
      cache: 'no-store',
    });

    const text = await backendRes.text();
    if (!backendRes.ok) {
      let details = text;
      try {
        const parsed = text ? JSON.parse(text) : null;
        if (parsed && typeof parsed === 'object') {
          details =
            String((parsed as { error?: string }).error || '') ||
            String((parsed as { message?: string }).message || '') ||
            text;
        }
      } catch {
        // keep raw text details
      }
      return apiError('INTERNAL_ERROR', backendRes.status, 'Google login init failed', details);
    }

    const payload = text ? JSON.parse(text) : {};
    return apiSuccess(payload);
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Google login init failed',
      error instanceof Error ? error.message : String(error),
    );
  }
}
