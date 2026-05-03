import { type NextRequest, NextResponse } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { backendUrl } from '@/lib/server/backend-url';



export async function POST(request: NextRequest) {
  try {
    const backendRes = await fetch(`${backendUrl()}/api/operator/auth/logout`, {
      method: 'POST',
      headers: {
        cookie: request.headers.get('cookie') || '',
      },
      cache: 'no-store',
    });

    const setCookie = backendRes.headers.get('set-cookie');
    const text = await backendRes.text();
    let json;
    try {
      json = text ? JSON.parse(text) : { ok: backendRes.ok, message: backendRes.statusText };
    } catch {
      json = { ok: backendRes.ok, error: text || backendRes.statusText };
    }

    if (!backendRes.ok) {
      return apiError('INTERNAL_ERROR', backendRes.status, 'Failed to logout operator session', json?.error || text);
    }

    const response = NextResponse.json(apiSuccess(json));
    if (setCookie) {
      response.headers.append('set-cookie', setCookie);
    }
    return response;
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to logout operator session',
      error instanceof Error ? error.message : String(error),
    );
  }
}
