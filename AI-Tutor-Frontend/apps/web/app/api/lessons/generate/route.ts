import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { getSessionToken } from '@/lib/auth/session';

const log = createLogger('LessonsGenerateProxy');

function getProxyUrl(): string | undefined {
  return process.env.AI_TUTOR_PROXY_URL;
}

export async function POST(req: NextRequest) {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) {
    return NextResponse.json(
      { error: 'AI_TUTOR_PROXY_URL is not configured' },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const token = getSessionToken();

    const response = await fetch(`${proxyUrl.replace(/\/$/, '')}/api/lessons/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({
      error: `Proxy returned ${response.status}`,
    }));

    if (!response.ok) {
      log.error('Generation proxy error:', response.status, data);
      return NextResponse.json(
        { error: data.error || `Proxy returned ${response.status}` },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    log.error('Generation proxy failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Proxy request failed' },
      { status: 500 }
    );
  }
}
