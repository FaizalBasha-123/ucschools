import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { backendUrl } from '@/lib/server/backend-url';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: invoiceId } = await params;
    const cookieStore = await cookies();
    let sessionId = cookieStore.get('ai_tutor_ops_session');
    if (!sessionId) {
      const token = request.headers.get('x-operator-token') || request.headers.get('authorization')?.replace('Bearer ', '');
      if (token) sessionId = { name: 'ai_tutor_ops_session', value: token } as any;
    }

    if (!sessionId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const res = await fetch(
      `${backendUrl()}/api/operator/billing/invoices/${invoiceId}/pdf`,
      {
        headers: {
          'Cookie': `ai_tutor_ops_session=${sessionId.value}`,
        },
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }

    const pdfBytes = await res.arrayBuffer();
    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="invoice-${invoiceId.slice(0, 12)}.pdf"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
