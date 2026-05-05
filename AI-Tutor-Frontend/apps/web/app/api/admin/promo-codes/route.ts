import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { backendUrl } from '@/lib/server/backend-url';

export async function GET(request: NextRequest) {
  try {
    const apiBaseUrl = backendUrl();
    const cookieStore = await cookies();
    const sessionId = cookieStore.get('ai_tutor_ops_session');

    if (!sessionId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const res = await fetch(`${apiBaseUrl}/api/admin/promo-codes`, {
      method: 'GET',
      headers: {
        'Cookie': `ai_tutor_ops_session=${sessionId.value}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({ success: false, error: `Backend error: ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const apiBaseUrl = backendUrl();
    const cookieStore = await cookies();
    const sessionId = cookieStore.get('ai_tutor_ops_session');

    if (!sessionId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const res = await fetch(`${apiBaseUrl}/api/admin/promo-codes`, {
      method: 'POST',
      headers: {
        'Cookie': `ai_tutor_ops_session=${sessionId.value}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return NextResponse.json({ success: false, error: `Backend error: ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
