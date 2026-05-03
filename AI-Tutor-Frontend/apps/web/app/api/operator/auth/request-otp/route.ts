import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { backendUrl } from '@/lib/server/backend-url';



export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const backendRes = await fetch(`${backendUrl()}/api/operator/auth/request-otp`, {
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
