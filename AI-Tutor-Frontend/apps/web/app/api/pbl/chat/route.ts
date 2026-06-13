/**
 * PBL Runtime Chat API
 *
 * Handles @mention routing during PBL runtime.
 * Students @question or @judge an agent, and this endpoint generates a response.
 */

import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError } from '@/lib/server/api-response';
import { authHeadersFrom } from '@/lib/server/auth';
import { backendUrl } from '@/lib/server/backend-url';
const log = createLogger('PBL Chat');

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const backendRes = await fetch(`${backendUrl()}/api/runtime/pbl/chat-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeadersFrom(req),
        ...(req.headers.get('x-api-key')
          ? { 'x-api-key': req.headers.get('x-api-key') as string }
          : {}),
        ...(req.headers.get('x-base-url')
          ? { 'x-base-url': req.headers.get('x-base-url') as string }
          : {}),
        ...(req.headers.get('x-requires-api-key')
          ? { 'x-requires-api-key': req.headers.get('x-requires-api-key') as string }
          : {}),
      },
      body: JSON.stringify(body),
    });

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      log.error(`Backend PBL chat failed: [${backendRes.status}] ${errorText}`);
      return apiError('INTERNAL_ERROR', backendRes.status, 'Backend PBL chat failed', errorText);
    }

    return new Response(backendRes.body, {
      status: 200,
      headers: { 
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      },
    });
  } catch (error) {
    log.error(`PBL proxy chat failed:`, error);
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
