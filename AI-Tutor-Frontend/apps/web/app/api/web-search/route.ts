/**
 * Web Search API
 *
 * POST /api/web-search
 * Proxies the request to the Rust backend to keep API keys server-side.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';

const log = createLogger('WebSearch');

export async function POST(req: NextRequest) {
  let query: string | undefined;
  try {
    const body = await req.json();
    query = body.query;

    if (!query || !query.trim()) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'query is required');
    }

    const backendUrl =
      process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL ||
      process.env.AI_TUTOR_API_BASE_URL ||
      'http://127.0.0.1:8099';

    // Proxy the request to the Rust backend
    const backendRes = await fetch(`${backendUrl}/api/tools/web-search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: body.query,
        pdfText: body.pdfText,
      }),
    });

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      log.error(`Backend web search failed: ${backendRes.status} ${errorText}`);
      return apiError('UPSTREAM_ERROR', backendRes.status, 'Backend search failed', errorText);
    }

    const json = await backendRes.json();
    return NextResponse.json(json);
  } catch (err) {
    log.error(`Web search failed [query="${query?.substring(0, 60) ?? 'unknown'}"]:`, err);
    const message = err instanceof Error ? err.message : 'Web search failed';
    return apiError('INTERNAL_ERROR', 500, message);
  }
}
