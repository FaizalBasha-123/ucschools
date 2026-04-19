import { NextRequest } from 'next/server';
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
    const backendRes = await fetch(`${backendUrlBase()}/api/auth/google/login`, {
      method: 'GET',
      headers: {
        cookie: request.headers.get('cookie') || '',
      },
      cache: 'no-store',
    });

    const text = await backendRes.text();
    if (!backendRes.ok) {
      return apiError('INTERNAL_ERROR', backendRes.status, 'Google login init failed', text);
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
