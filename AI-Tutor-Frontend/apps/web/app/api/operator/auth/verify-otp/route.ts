import { type NextRequest, NextResponse } from 'next/server';
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
    const backendRes = await fetch(`${backendUrlBase()}/api/operator/auth/verify-otp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
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
      return apiError('INTERNAL_ERROR', backendRes.status, 'Failed to verify operator OTP', json?.error || text);
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
      'Failed to verify operator OTP',
      error instanceof Error ? error.message : String(error),
    );
  }
}
