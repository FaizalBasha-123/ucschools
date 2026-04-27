import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    const apiBaseUrl = process.env.AI_TUTOR_API_BASE_URL || 'http://127.0.0.1:8099';
    const cookieStore = cookies();
    const sessionId = cookieStore.get('ai_tutor_operator_session');
    if (!sessionId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const body = await request.json();
    const res = await fetch(`${apiBaseUrl}/api/admin/schools/assign-user`, {
      method: 'POST',
      headers: { 'Cookie': `ai_tutor_operator_session=${sessionId.value}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return NextResponse.json({ success: false, error: `Backend: ${res.status}` }, { status: res.status });
    const data = await res.json();
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
