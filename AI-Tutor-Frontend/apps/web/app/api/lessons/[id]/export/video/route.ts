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
    `${backendUrlBase()}/api/lessons/${encodeURIComponent(id)}/export/video`,
    {
      method: 'GET',
      headers: authHeadersFrom(request),
      cache: 'no-store',
    },
  );

  const contentType = backendRes.headers.get('content-type') || 'video/mp4';
  const contentDisposition =
    backendRes.headers.get('content-disposition') ||
    `attachment; filename="lesson-${id}.mp4"`;

  if (!backendRes.ok) {
    const text = await backendRes.text();
    return new Response(text || 'Failed to export lesson video', {
      status: backendRes.status,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  if (!backendRes.body) {
    return new Response('Failed to stream lesson video', {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response(backendRes.body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-disposition': contentDisposition,
    },
  });
}
