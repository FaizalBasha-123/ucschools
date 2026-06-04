import { type NextRequest, NextResponse } from 'next/server';
import { authHeadersFrom } from '@/lib/server/auth';
import { backendUrl } from '@/lib/server/backend-url';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: invoiceId } = await params;

  try {
    const res = await fetch(
      `${backendUrl()}/api/billing/invoices/${invoiceId}/pdf`,
      {
        headers: { ...authHeadersFrom(request) },
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `PDF generation failed: ${text}` },
        { status: res.status }
      );
    }

    const pdfBytes = await res.arrayBuffer();

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="invoice-${invoiceId.slice(0, 12)}.pdf"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
