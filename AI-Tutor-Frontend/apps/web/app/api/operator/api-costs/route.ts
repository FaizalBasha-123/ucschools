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

    const url = new URL(request.url);
    const res = await fetch(`${apiBaseUrl}/api/operator/api-costs${url.search}`, {
      method: 'GET',
      headers: {
        'Cookie': `ai_tutor_ops_session=${sessionId.value}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({
          success: true,
          total_cost_usd_30d: 0, openrouter_cost_usd: 0, groq_cost_usd: 0,
          tts_cost_usd: 0, estimated_margin_30d: 0,
          by_component: [], per_user: [],
        });
      }
      return NextResponse.json({ success: false, error: `Backend error: ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({
      success: true,
      total_cost_usd_30d: 0, openrouter_cost_usd: 0, groq_cost_usd: 0,
      tts_cost_usd: 0, estimated_margin_30d: 0,
      by_component: [], per_user: [],
    });
  }
}
