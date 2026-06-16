import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';
import { backendUrl } from '@/lib/server/backend-url';

export const runtime = 'edge';

const log = createLogger('LessonsGenerateProxy');

export async function POST(req: NextRequest) {
  const backend = backendUrl();

  try {
    const body = await req.json();

    const response = await fetch(`${backend.replace(/\/$/, '')}/api/lessons/generate-stream`, {
      method: 'POST',
      headers: {
        ...authHeadersFrom(req),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: `Proxy returned ${response.status}` }));
      log.error('Generation proxy error:', response.status, data);
      return NextResponse.json(
        { error: data.error || `Proxy returned ${response.status}` },
        { status: response.status }
      );
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err) {
    log.error('Generation proxy failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Proxy request failed' },
      { status: 500 }
    );
  }
}
