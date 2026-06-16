import { type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { backendUrl } from '@/lib/server/backend-url';

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const backendRes = await fetch(`${backendUrl()}/api/operator/auth/verify-otp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

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

    const response = apiSuccess(json);
    if (json.operator_token) {
      const cookieStore = await cookies();
      cookieStore.set({
        name: 'ai_tutor_ops_session',
        value: json.operator_token,
        httpOnly: true,
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 3456000, // 40 days
        expires: new Date(Date.now() + 3456000 * 1000)
      });
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
