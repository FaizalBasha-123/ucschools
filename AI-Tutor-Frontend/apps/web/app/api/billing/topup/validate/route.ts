import { type NextRequest, NextResponse } from 'next/server';
import { backendUrl } from '@/lib/server/backend-url';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ valid: false, reason_error: 'Missing token' }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${backendUrl()}/api/billing/topup/${encodeURIComponent(token)}/validate`,
      { cache: 'no-store' }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ valid: false, reason_error: err.message }, { status: 500 });
  }
}
