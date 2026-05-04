import { type NextRequest } from 'next/server';
import { authHeadersFrom } from '@/lib/server/auth';
import { backendUrl } from '@/lib/server/backend-url';



export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const backendRes = await fetch(
    `${backendUrl()}/api/lessons/${encodeURIComponent(id)}/export/html`,
    {
      method: 'GET',
      headers: authHeadersFrom(request),
      cache: 'no-store',
    },
  );

  const text = await backendRes.text();
  const contentType = backendRes.headers.get('content-type') || 'text/html; charset=utf-8';
  const contentDisposition =
    backendRes.headers.get('content-disposition') ||
    `attachment; filename="lesson-${id}.html"`;

  return new Response(text, {
    status: backendRes.status,
    headers: {
      'content-type': contentType,
      'content-disposition': contentDisposition,
    },
  });
}
