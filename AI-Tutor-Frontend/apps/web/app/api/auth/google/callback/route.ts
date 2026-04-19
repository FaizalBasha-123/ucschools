import { NextRequest, NextResponse } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';

function backendUrlBase(): string {
  return (
    process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL ||
    process.env.AI_TUTOR_API_BASE_URL ||
    'http://127.0.0.1:8099'
  );
}

export async function GET(request: NextRequest) {
  try {
    const qs = request.nextUrl.searchParams.toString();
    const backendRes = await fetch(`${backendUrlBase()}/api/auth/google/callback?${qs}`, {
      method: 'GET',
      headers: {
        cookie: request.headers.get('cookie') || '',
      },
      redirect: 'manual',
      cache: 'no-store',
    });

    const setCookie = backendRes.headers.get('set-cookie');
    const text = await backendRes.text();

    if (!backendRes.ok && backendRes.status !== 302) {
      return apiError('INTERNAL_ERROR', backendRes.status, 'Google callback failed', text);
    }

    const payload = text ? JSON.parse(text) : {};
    const response = NextResponse.json(apiSuccess(payload));

    if (setCookie) {
      response.headers.append('set-cookie', setCookie);
    }

    return response;
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Google callback failed',
      error instanceof Error ? error.message : String(error),
    );
  }
}
