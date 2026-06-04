import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { backendUrl } from '@/lib/server/backend-url';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params;
    const cookieStore = await cookies();
    const sessionId = cookieStore.get('ai_tutor_ops_session');

    if (!sessionId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    const res = await fetch(
      `${backendUrl()}/api/operator/users/${userId}/topup-link`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `ai_tutor_ops_session=${sessionId.value}`,
          'X-Operator-Header': 'true',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      }
    );

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
