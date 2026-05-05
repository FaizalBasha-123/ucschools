import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { backendUrl } from '@/lib/server/backend-url';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.credential) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing credential');
    }

    const backendRes = await fetch(`${backendUrl()}/api/auth/google/onetap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: request.headers.get('cookie') || '',
      },
      body: JSON.stringify({ credential: body.credential }),
      cache: 'no-store',
    });

    const setCookie = backendRes.headers.get('set-cookie');
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
      return apiError('INTERNAL_ERROR', backendRes.status, 'Google One Tap auth failed', details);
    }

    const payload = text ? JSON.parse(text) : {};
    const response = apiSuccess(payload);

    if (setCookie) {
      response.headers.append('set-cookie', setCookie);
    }

    return response;
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Google One Tap auth failed',
      error instanceof Error ? error.message : String(error),
    );
  }
}
