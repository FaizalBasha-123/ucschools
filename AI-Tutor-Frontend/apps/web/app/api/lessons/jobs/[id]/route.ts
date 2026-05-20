import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';

const log = createLogger('LessonsJobProxy');

function getProxyUrl(): string | undefined {
  return process.env.AI_TUTOR_PROXY_URL;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) {
    return NextResponse.json(
      { error: 'AI_TUTOR_PROXY_URL is not configured' },
      { status: 503 }
    );
  }

  try {
    const { id } = await params;

    const response = await fetch(
      `${proxyUrl.replace(/\/$/, '')}/api/lessons/jobs/${encodeURIComponent(id)}`,
      {
        method: 'GET',
        headers: {
          ...authHeadersFrom(req),
        },
      }
    );

    const data = await response.json().catch(() => ({
      error: `Proxy returned ${response.status}`,
    }));

    if (!response.ok) {
      log.error('Job poll proxy error:', response.status, data);
      return NextResponse.json(
        { error: data.error || `Proxy returned ${response.status}` },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    log.error('Job poll proxy failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Proxy request failed' },
      { status: 500 }
    );
  }
}
