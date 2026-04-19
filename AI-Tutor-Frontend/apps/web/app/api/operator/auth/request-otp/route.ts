import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';

function backendUrlBase(): string {
  return (
    process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL ||
    process.env.AI_TUTOR_API_BASE_URL ||
    'http://127.0.0.1:8099'
  );
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const backendRes = await fetch(`${backendUrlBase()}/api/operator/auth/request-otp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    const text = await backendRes.text();
    const json = text ? JSON.parse(text) : { ok: backendRes.ok, message: backendRes.statusText };

    if (!backendRes.ok) {
      return apiError('INTERNAL_ERROR', backendRes.status, 'Failed to request operator OTP', json?.error || text);
    }

    return apiSuccess(json);
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to request operator OTP',
      error instanceof Error ? error.message : String(error),
    );
  }
}
