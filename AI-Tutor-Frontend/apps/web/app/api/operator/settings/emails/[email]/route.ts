import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { backendUrl } from '@/lib/server/backend-url';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  try {
    const { email } = await params;
    const decodedEmail = decodeURIComponent(email);
    const apiBaseUrl = backendUrl();
    const cookieStore = await cookies();
    const sessionId = cookieStore.get('ai_tutor_ops_session');
    if (!sessionId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const res = await fetch(`${apiBaseUrl}/api/operator/settings/emails/${encodeURIComponent(decodedEmail)}`, {
      method: 'DELETE',
      headers: { 'Cookie': `ai_tutor_ops_session=${sessionId.value}` },
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ success: false, error: text || `Backend: ${res.status}` }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
