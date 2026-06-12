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
import { backendUrl } from '@/lib/server/backend-url';
import { authHeadersFrom } from '@/lib/server/auth';

const log = createLogger('Classroom API');

export const maxDuration = 30; // Allow enough time for Render cold start

/**
 * The Rust backend serializes with snake_case (serde default).
 * The frontend Stage/Scene types use camelCase.
 * Normalize at the proxy boundary so no client code needs to handle both.
 */
function normalizeLesson(lesson: any) {
  const normalizeStage = (s: any) => {
    if (!s) return s;
    return {
      ...s,
      createdAt: s.created_at ?? s.createdAt,
      updatedAt: s.updated_at ?? s.updatedAt,
      agentIds: s.agent_ids ?? s.agentIds ?? [],
      generatedAgentConfigs: s.generated_agent_configs ?? s.generatedAgentConfigs ?? [],
    };
  };

  const normalizeScene = (sc: any) => {
    if (!sc) return sc;
    
    // Normalize content
    let content = sc.content;
    if (content) {
      if (content.type === 'slide' && content.canvas) {
        const c = content.canvas;
        content = {
          ...content,
          canvas: {
            ...c,
            viewportWidth: c.viewportWidth ?? c.viewport_width ?? 1000,
            viewportHeight: c.viewportHeight ?? c.viewport_height ?? 563,
            viewportRatio: c.viewportRatio ?? c.viewport_ratio ?? 0.5625,
            theme: c.theme ? {
              ...c.theme,
              backgroundColor: c.theme.backgroundColor ?? c.theme.background_color ?? '#ffffff',
              themeColors: c.theme.themeColors ?? c.theme.theme_colors ?? [],
              fontColor: c.theme.fontColor ?? c.theme.font_color ?? '#000000',
              fontName: (c.theme as any).fontName ?? (c.theme as any).font_name ?? 'Microsoft YaHei',
            } : undefined,
            elements: Array.isArray(c.elements)
              ? c.elements.map((el: any) => {
                  const type = el.type ?? el.kind ?? 'text';
                  const base = {
                    rotate: 0,
                    opacity: 1,
                    fixedRatio: true,
                    ...el,
                    type,
                  };

                  if (type === 'text') {
                    return {
                      ...base,
                      content: el.content ?? '',
                      defaultFontName: el.defaultFontName ?? el.default_font_name ?? 'Microsoft YaHei',
                      defaultColor: el.defaultColor ?? el.default_color ?? '#333333',
                    };
                  }
                  if (type === 'image') {
                    return {
                      ...base,
                      src: el.src ?? '',
                      fixedRatio: el.fixedRatio ?? el.fixed_ratio ?? true,
                    };
                  }
                  if (type === 'shape') {
                    return {
                      ...base,
                      shapeName: el.shapeName ?? el.shape_name ?? 'rect',
                      viewBox: el.viewBox ?? [el.width ?? 100, el.height ?? 100],
                      path: el.path ?? 'M 0 0 L 100 0 L 100 100 L 0 100 Z',
                      fill: el.fill ?? '#333333',
                    };
                  }
                  if (type === 'line') {
                    return {
                      ...base,
                      start: el.start ?? [0, 0],
                      end: el.end ?? [el.width ?? 100, el.height ?? 0],
                      points: el.points ?? ['', ''],
                      color: el.color ?? '#333333',
                      style: el.style ?? 'solid',
                    };
                  }
                  if (type === 'chart') {
                    return {
                      ...base,
                      chartType: el.chartType ?? el.chart_type ?? 'bar',
                      data: el.data ?? { labels: [], legends: [], series: [] },
                      themeColors: el.themeColors ?? el.theme_colors ?? c.theme?.themeColors ?? c.theme?.theme_colors ?? ['#1f2937', '#0f766e', '#2563eb'],
                    };
                  }
                  if (type === 'table') {
                    return {
                      ...base,
                      data: el.data ?? [],
                      colWidths: el.colWidths ?? el.col_widths ?? [],
                      cellMinHeight: el.cellMinHeight ?? el.cell_min_height ?? 40,
                    };
                  }
                  if (type === 'latex') {
                    return {
                      ...base,
                      latex: el.latex ?? '',
                      viewBox: el.viewBox ?? [el.width ?? 100, el.height ?? 100],
                      path: el.path ?? '',
                    };
                  }
                  return base;
                })
              : [],
          },
        };
      } else if (content.type === 'quiz' && Array.isArray(content.questions)) {
        content = {
          ...content,
          questions: content.questions.map((q: any) => ({
            ...q,
            type: q.type ?? q.question_type,
            commentPrompt: q.commentPrompt ?? q.comment_prompt,
            hasAnswer: q.hasAnswer ?? q.has_answer,
          })),
        };
      } else if (content.type === 'interactive') {
        content = {
          ...content,
          scientificModel: content.scientificModel ?? content.scientific_model,
        };
      } else if (content.type === 'project' || content.type === 'pbl') {
        // Backend uses 'project', frontend uses 'pbl'
        const pc = content.project_config ?? content.projectConfig;
        content = {
          ...content,
          type: 'pbl',
          projectConfig: pc
            ? {
                ...pc,
                drivingQuestion: pc.driving_question ?? pc.drivingQuestion,
                learningObjectives: pc.learning_objectives ?? pc.learningObjectives,
                requiredResources: pc.required_resources ?? pc.requiredResources,
                evaluationCriteria: pc.evaluation_criteria ?? pc.evaluationCriteria,
              }
            : undefined,
        };
      }
    }

    const resolvedType = sc.scene_type ?? sc.type ?? content?.type;
    return {
      ...sc,
      type: resolvedType === 'project' ? 'pbl' : resolvedType,
      stageId: sc.stage_id ?? sc.stageId,
      createdAt: sc.created_at ?? sc.createdAt,
      updatedAt: sc.updated_at ?? sc.updatedAt,
      content,
      multiAgent: sc.multi_agent
        ? {
            enabled: sc.multi_agent.enabled,
            agentIds: sc.multi_agent.agent_ids ?? [],
            directorPrompt: sc.multi_agent.director_prompt,
          }
        : (sc.multiAgent ?? undefined),
    };
  };

  return {
    ...lesson,
    stage: normalizeStage(lesson.stage),
    scenes: Array.isArray(lesson.scenes) ? lesson.scenes.map(normalizeScene) : [],
  };
}

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

    // 2. Fallback to Rust backend for generated lessons/legacy paths.
    // /api/lessons/{id} is session_auth_required — forward the user JWT or it returns 401.
    const backendRes = await fetch(`${backendUrl()}/api/lessons/${id}`, {
      method: 'GET',
      headers: authHeadersFrom(request),
    });

    if (backendRes.status === 404) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      log.error(`Backend lesson retrieval failed: [${backendRes.status}] ${errorText}`);
      return apiError(API_ERROR_CODES.INTERNAL_ERROR, backendRes.status, 'Failed to fetch lesson', errorText);
    }

    const raw = await backendRes.json();
    const classroom = normalizeLesson(raw);
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
