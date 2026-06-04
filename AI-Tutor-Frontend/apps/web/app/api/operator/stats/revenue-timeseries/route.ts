import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { backendUrl } from '@/lib/server/backend-url';

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get('ai_tutor_ops_session');

    if (!sessionId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const days = request.nextUrl.searchParams.get('days') || '30';

    const res = await fetch(
      `${backendUrl()}/api/operator/stats/revenue-timeseries?days=${days}`,
      {
        headers: {
          'Cookie': `ai_tutor_ops_session=${sessionId.value}`,
        },
        cache: 'no-store',
      }
    );

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
