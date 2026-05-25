/**
 * POST /api/lessons/[id]/doubt/[wbId]  — Follow-up question in existing session
 * DELETE /api/lessons/[id]/doubt/[wbId] — End session + purge R2 assets + Redis key
 */

import { type NextRequest } from 'next/server';
import { apiError } from '@/lib/server/api-response';
import { authHeadersFrom } from '@/lib/server/auth';
import { backendUrl } from '@/lib/server/backend-url';

type Params = Promise<{ id: string; wbId: string }>;

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id: lessonId, wbId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Request body must be valid JSON');
  }

  const backendRes = await fetch(
    `${backendUrl()}/api/lessons/${lessonId}/doubt/${wbId}`,
    {
      method: 'POST',
      headers: {
        ...authHeadersFrom(req),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  ).catch((e) => {
    throw new Error(`Backend unreachable: ${e}`);
  });

  const data = await backendRes.json().catch(() => null);

  if (!backendRes.ok) {
    return apiError('UPSTREAM_ERROR', backendRes.status, data?.error || 'Follow-up failed');
  }

  return Response.json(data, { status: 200 });
}

export async function DELETE(req: NextRequest, { params }: { params: Params }) {
  const { id: lessonId, wbId } = await params;

  // Best-effort DELETE — fire and forget from client's perspective
  await fetch(`${backendUrl()}/api/lessons/${lessonId}/doubt/${wbId}`, {
    method: 'DELETE',
    headers: authHeadersFrom(req),
  }).catch(() => {
    // Non-fatal — Redis TTL will clean up in 2h anyway
  });

  return new Response(null, { status: 204 });
}
