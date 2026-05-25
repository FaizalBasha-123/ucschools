/**
 * POST /api/lessons/[id]/doubt
 *
 * Proxies to Rust backend: POST /api/lessons/{lesson_id}/doubt
 * Starts a new ephemeral whiteboard doubt session.
 *
 * Body: { question, scene_index, scene_title, quality_mode?, enable_image_generation? }
 * Response: { wb_session_id, actions: WhiteboardActionEvent[], credits_used }
 */

import { type NextRequest } from 'next/server';
import { apiError } from '@/lib/server/api-response';
import { authHeadersFrom } from '@/lib/server/auth';
import { backendUrl } from '@/lib/server/backend-url';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: lessonId } = await params;

  if (!lessonId) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'lessonId is required');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Request body must be valid JSON');
  }

  const backendRes = await fetch(`${backendUrl()}/api/lessons/${lessonId}/doubt`, {
    method: 'POST',
    headers: {
      ...authHeadersFrom(req),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }).catch((e) => {
    throw new Error(`Backend unreachable: ${e}`);
  });

  const data = await backendRes.json().catch(() => null);

  if (!backendRes.ok) {
    return apiError(
      'UPSTREAM_ERROR',
      backendRes.status,
      data?.error || 'Whiteboard doubt failed',
    );
  }

  return Response.json(data, { status: 200 });
}
