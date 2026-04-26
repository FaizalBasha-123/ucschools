import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { type GenerateClassroomInput } from '@/lib/server/classroom-generation';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('GenerateClassroom API');

export const maxDuration = 30;

function authHeadersFrom(request: NextRequest): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const authorization = request.headers.get('authorization');
  const cookie = request.headers.get('cookie');
  if (authorization) headers.authorization = authorization;
  if (cookie) headers.cookie = cookie;
  return headers;
}

export async function POST(req: NextRequest) {
  let requirementSnippet: string | undefined;
  try {
    const rawBody = (await req.json()) as Partial<GenerateClassroomInput>;
    requirementSnippet = rawBody.requirement?.substring(0, 60);

    if (!rawBody.requirement) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: requirement');
    }

    const payload = {
      requirement: rawBody.requirement,
      pdf_text: rawBody.pdfContent,
      language: rawBody.language,
      enable_web_search: rawBody.enableWebSearch,
      enable_image_generation: rawBody.enableImageGeneration,
      enable_video_generation: rawBody.enableVideoGeneration,
      enable_tts: rawBody.enableTTS,
      agent_mode: rawBody.agentMode,
      generation_mode: rawBody.generationMode,
    };

    const backendUrl = process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL || process.env.AI_TUTOR_API_BASE_URL || 'http://127.0.0.1:8099';
    const baseUrl = buildRequestOrigin(req);

    const backendRes = await fetch(`${backendUrl}/api/lessons/generate-async`, {
      method: 'POST',
      headers: authHeadersFrom(req),
      body: JSON.stringify(payload),
    });

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      log.error(`Backend generation failed: [${backendRes.status}] ${errorText}`);
      return apiError('INTERNAL_ERROR', backendRes.status, 'Backend completely failed to process lesson', errorText);
    }

    const { job_id } = await backendRes.json();
    const pollUrl = `${baseUrl}/api/generate-classroom/${job_id}`;

    return apiSuccess(
      {
        jobId: job_id,
        status: 'queued',
        step: 'pending',
        message: 'Task initiated successfully',
        pollUrl,
        pollIntervalMs: 5000,
      },
      202,
    );
  } catch (error) {
    log.error(
      `Classroom generation job creation failed [requirement="${requirementSnippet ?? 'unknown'}..."]:`,
      error,
    );
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to create classroom generation job',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
