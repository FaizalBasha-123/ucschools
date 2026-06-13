import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';

const log = createLogger('LessonsJobActionProxy');

function getProxyUrl(): string | undefined {
  return process.env.AI_TUTOR_PROXY_URL;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) {
    return NextResponse.json(
      { error: 'AI_TUTOR_PROXY_URL is not configured' },
      { status: 503 }
    );
  }

  try {
    const { id, action } = await params;

    if (action !== 'cancel' && action !== 'resume') {
      return NextResponse.json(
        { error: 'Invalid action. Only cancel or resume are allowed.' },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${proxyUrl.replace(/\/$/, '')}/api/lessons/jobs/${encodeURIComponent(id)}/${encodeURIComponent(action)}`,
      {
        method: 'POST',
        headers: {
          ...authHeadersFrom(req),
        },
      }
    );

    const data = await response.json().catch(() => ({
      error: `Proxy returned ${response.status}`,
    }));

    if (!response.ok) {
      log.error(`Proxy failed with status ${response.status}`, { data });
      return NextResponse.json(
        { error: data.error || data.details || `Failed to ${action} job` },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    log.error('Proxy error', err);
    return NextResponse.json(
      { error: 'Failed to communicate with API server' },
      { status: 500 }
    );
  }
}
