import { NextRequest, NextResponse } from 'next/server';
import { backendUrl } from '@/lib/server/backend-url';

/**
 * Proxies token refresh requests to the backend.
 * The backend validates the opaque refresh token, rotates it,
 * and returns a new access_token + refresh_token pair.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const backendRes = await fetch(`${backendUrl()}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward cookies in case the backend uses cookie-based refresh
        cookie: request.headers.get('cookie') || '',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    const data = await backendRes.json().catch(() => ({}));

    if (!backendRes.ok) {
      return NextResponse.json(
        { success: false, error: data?.error || 'Token refresh failed' },
        { status: backendRes.status }
      );
    }

    const response = NextResponse.json({ success: true, ...data });

    // Forward any Set-Cookie headers (e.g. refreshed session cookie)
    const setCookie = backendRes.headers.get('set-cookie');
    if (setCookie) {
      response.headers.append('set-cookie', setCookie);
    }

    return response;
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Token refresh failed' },
      { status: 500 }
    );
  }
}
