import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';

const log = createLogger('ClassroomJob API');

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  let resolvedJobId: string | undefined;
  try {
    const { jobId } = await context.params;
    resolvedJobId = jobId;

    if (!jobId) {
      return apiError('INVALID_REQUEST', 400, 'Invalid classroom generation job id');
    }

    const backendUrl = process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL || process.env.AI_TUTOR_API_BASE_URL || 'http://127.0.0.1:8099';
    const backendRes = await fetch(`${backendUrl}/api/lessons/jobs/${jobId}`, {
      method: 'GET',
      headers: authHeadersFrom(req),
    });

    if (backendRes.status === 404) {
      return apiError('INVALID_REQUEST', 404, 'Classroom generation job not found');
    }
    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      log.error(`Backend job retrieval failed: [${backendRes.status}] ${errorText}`);
      return apiError('INTERNAL_ERROR', backendRes.status, 'Backend failed to retrieve job', errorText);
    }

    const job = await backendRes.json();
    const pollUrl = `${buildRequestOrigin(req)}/api/generate-classroom/${jobId}`;

    return apiSuccess({
      jobId: job.id,
      status: job.status,
      step: job.step,
      progress: job.progress,
      message: job.message,
      pollUrl,
      pollIntervalMs: 5000,
      scenesGenerated: job.scenes_generated,
      totalScenes: job.total_scenes,
      result: job.result ? { lessonId: job.result.lesson_id, url: job.result.url } : undefined,
      error: job.error,
      done: job.status === 'succeeded' || job.status === 'failed',
    });
  } catch (error) {
    log.error(`Classroom job retrieval failed [jobId=${resolvedJobId ?? 'unknown'}]:`, error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to retrieve classroom generation job',
      error instanceof Error ? error.message : String(error),
    );
  }
}

