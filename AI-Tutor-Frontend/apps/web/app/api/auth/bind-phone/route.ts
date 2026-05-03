import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { backendUrl } from '@/lib/server/backend-url';


export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const backendRes = await fetch(`${backendUrl()}/api/auth/bind-phone`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: request.headers.get('cookie') || '',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    const setCookie = backendRes.headers.get('set-cookie');
    const text = await backendRes.text();

    if (!backendRes.ok) {
      let errorMsg = 'Phone verification failed';
      try {
        const parsed = JSON.parse(text);
        errorMsg = parsed.error || parsed.message || errorMsg;
      } catch {
        // use default
      }
      return apiError('INTERNAL_ERROR', backendRes.status, errorMsg, text);
    }

    let payload: Record<string, unknown> = {};
    if (text) {
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch {
        payload = { raw: text };
      }
    }

    const response = apiSuccess(payload);

    if (setCookie) {
      response.headers.append('set-cookie', setCookie);
    }

    return response;
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Phone verification failed',
      error instanceof Error ? error.message : String(error),
    );
  }
}
