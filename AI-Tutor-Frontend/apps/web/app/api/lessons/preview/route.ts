import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';
import { backendUrl } from '@/lib/server/backend-url';

const log = createLogger('LessonPreviewProxy');

export async function POST(req: NextRequest) {
  const backend = backendUrl();

  try {
    const body = await req.json();

    const response = await fetch(`${backend.replace(/\/$/, '')}/api/lessons/preview`, {
      method: 'POST',
      headers: {
        ...authHeadersFrom(req),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({
      error: `Proxy returned ${response.status}`,
    }));

    if (!response.ok) {
      log.error('Preview proxy error:', response.status, data);
      return NextResponse.json(
        { error: data.error || `Proxy returned ${response.status}` },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    log.error('Preview proxy failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Proxy request failed' },
      { status: 500 }
    );
  }
}
