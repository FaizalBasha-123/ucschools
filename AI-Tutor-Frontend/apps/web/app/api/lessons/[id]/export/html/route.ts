import { type NextRequest } from 'next/server';
import { authHeadersFrom } from '@/lib/server/auth';

function backendUrlBase(): string {
  return (
    process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL ||
    process.env.AI_TUTOR_API_BASE_URL ||
    'http://127.0.0.1:8099'
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const backendRes = await fetch(
    `${backendUrlBase()}/api/lessons/${encodeURIComponent(id)}/export/html`,
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
