import { type NextRequest } from 'next/server';
import { backendUrl } from '@/lib/server/backend-url';
import { authHeadersFrom } from '@/lib/server/auth';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const url = `${backendUrl()}/api/system/db-ready`;
  
  const response = await fetch(url, {
    headers: authHeadersFrom(request),
  });

  if (!response.ok) {
    return new Response('Failed to connect to backend', { status: response.status });
  }

  // Proxy the SSE stream
  return new Response(response.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
