import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';

function backendUrlBase(): string {
  return (
    process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL ||
    process.env.AI_TUTOR_API_BASE_URL ||
    'http://127.0.0.1:8099'
  );
}

function authHeadersFrom(request: NextRequest): HeadersInit {
  const headers: Record<string, string> = {};
  const authorization = request.headers.get('authorization');
  const cookie = request.headers.get('cookie');
  if (authorization) headers.authorization = authorization;
  if (cookie) headers.cookie = cookie;
  return headers;
}

export async function GET(request: NextRequest) {
  try {
    const backendRes = await fetch(`${backendUrlBase()}/api/admin/settings`, {
      method: 'GET',
      headers: authHeadersFrom(request),
      cache: 'no-store',
    });

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      return apiError('INTERNAL_ERROR', backendRes.status, 'Failed to load admin settings', errorText);
    }

    const payload = await backendRes.json();
    return apiSuccess(payload);
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to load admin settings',
      error instanceof Error ? error.message : String(error),
    );
  }
}
