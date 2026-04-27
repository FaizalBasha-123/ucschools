import { type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import {
  buildRequestOrigin,
  isValidClassroomId,
  persistClassroom,
  readClassroom,
} from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom API');

export async function POST(request: NextRequest) {
  let stageId: string | undefined;
  let sceneCount: number | undefined;
  try {
    const body = await request.json();
    const { stage, scenes } = body;
    stageId = stage?.id;
    sceneCount = scenes?.length;

    if (!stage || !scenes) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields: stage, scenes',
      );
    }

    const id = stage.id || randomUUID();
    const baseUrl = buildRequestOrigin(request);

    const persisted = await persistClassroom({ id, stage: { ...stage, id }, scenes }, baseUrl);

    return apiSuccess({ id: persisted.id, url: persisted.url }, 201);
  } catch (error) {
    log.error(
      `Classroom storage failed [stageId=${stageId ?? 'unknown'}, scenes=${sceneCount ?? 0}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to store classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');

    if (!id || !isValidClassroomId(id)) {
      return apiError(
        API_ERROR_CODES.INVALID_REQUEST,
        400,
        'Invalid or missing classroom ID',
      );
    }

    // 1. Check local filesystem storage first (for shared classrooms)
    const localClassroom = await readClassroom(id);
    if (localClassroom) {
      // Security Check: Ensure we don't serve a classroom tagged as default
      // even if it somehow got into the shared storage.
      if ((localClassroom.stage as any).isDefault) {
        return apiError(API_ERROR_CODES.INVALID_REQUEST, 403, 'Default classrooms cannot be shared');
      }
      return apiSuccess({ classroom: localClassroom });
    }

    // 2. Fallback to Rust backend for generated lessons/legacy paths
    const backendUrl = process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL || process.env.AI_TUTOR_API_BASE_URL || 'http://127.0.0.1:8099';
    const backendRes = await fetch(`${backendUrl}/api/lessons/${id}`, {
      method: 'GET',
    });

    if (backendRes.status === 404) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      log.error(`Backend lesson retrieval failed: [${backendRes.status}] ${errorText}`);
      return apiError(API_ERROR_CODES.INTERNAL_ERROR, backendRes.status, 'Failed to fetch lesson', errorText);
    }

    const classroom = await backendRes.json();
    return apiSuccess({ classroom });
  } catch (error) {
    log.error(
      `Classroom retrieval failed [id=${request.nextUrl.searchParams.get('id') ?? 'unknown'}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}
