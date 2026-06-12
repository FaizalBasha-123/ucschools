/**
 * Stage Storage Manager
 *
 * Manages multiple stage data in IndexedDB
 * Each stage has its own storage key based on stageId
 */

import { Stage, Scene } from '../types/stage';
import { ChatSession } from '../types/chat';
import { db } from './database';
import { saveChatSessions, loadChatSessions, deleteChatSessions } from './chat-storage';
import { clearPlaybackState } from './playback-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('StageStorage');

export interface StageStoreData {
  stage: Stage;
  scenes: Scene[];
  currentSceneId: string | null;
  chats: ChatSession[];
}

export interface StageListItem {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  sceneCount: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Save stage data to IndexedDB
 */
export async function saveStageData(stageId: string, data: StageStoreData): Promise<void> {
  try {
    const now = Date.now();

    // Save to stages table
    await db.stages.put({
      id: stageId,
      name: data.stage.name || 'Untitled Stage',
      description: data.stage.description,
      createdAt: data.stage.createdAt || now,
      updatedAt: now,
      language: data.stage.language,
      style: data.stage.style,
      currentSceneId: data.currentSceneId || undefined,
      agentIds: data.stage.agentIds,
    });

    // Delete old scenes first to avoid orphaned data
    await db.scenes.where('stageId').equals(stageId).delete();

    // Save new scenes
    if (data.scenes && data.scenes.length > 0) {
      await db.scenes.bulkPut(
        data.scenes.map((scene, index) => ({
          ...scene,
          stageId,
          order: scene.order ?? index,
          createdAt: scene.createdAt || now,
          updatedAt: scene.updatedAt || now,
        })),
      );
    }

    // Save chat sessions to independent table
    if (data.chats) {
      await saveChatSessions(stageId, data.chats);
    }

    log.info(`Saved stage: ${stageId}`);
  } catch (error) {
    log.error('Failed to save stage:', error);
    throw error;
  }
}

/**
 * Load stage data from IndexedDB
 */
export async function loadStageData(stageId: string): Promise<StageStoreData | null> {
  try {
    // Load stage
    const stage = await db.stages.get(stageId);
    if (!stage) {
      log.info(`Stage not found: ${stageId}`);
      return null;
    }

    // Load scenes
    let scenes = await db.scenes.where('stageId').equals(stageId).sortBy('order');

    // Fix legacy missing type field and internal data structures (if cached before the API normalized it)
    scenes = scenes.map((sc) => {
      let resolvedType = (sc as any).scene_type ?? sc.type ?? sc.content?.type;
      if (resolvedType === 'project') resolvedType = 'pbl';
      
      const scene = { ...sc, type: resolvedType };
      
      // Normalize content if present
      if (scene.content) {
        if (scene.content.type === 'slide' && scene.content.canvas) {
          const c = scene.content.canvas;
          scene.content = {
            ...scene.content,
            canvas: {
              ...c,
              viewportSize: c.viewportSize ?? c.viewport_width ?? 1000,
              viewportHeight: c.viewportHeight ?? c.viewport_height ?? 563,
              viewportRatio: c.viewportRatio ?? c.viewport_ratio ?? 0.5625,
              theme: c.theme ? {
                ...c.theme,
                backgroundColor: c.theme.backgroundColor ?? c.theme.background_color ?? '#ffffff',
                themeColors: c.theme.themeColors ?? c.theme.theme_colors ?? [],
                fontColor: c.theme.fontColor ?? c.theme.font_color ?? '#000000',
                fontName: (c.theme as any).fontName ?? (c.theme as any).font_name ?? 'Microsoft YaHei',
              } : {
                backgroundColor: '#ffffff',
                themeColors: ['#333333'],
                fontColor: '#333333',
                fontName: 'Microsoft YaHei',
              },
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
            }
          };
        } else if (scene.content.type === 'quiz' && Array.isArray(scene.content.questions)) {
          scene.content = {
            ...scene.content,
            questions: scene.content.questions.map((q: any) => ({
              ...q,
              type: q.type ?? q.question_type,
              commentPrompt: q.commentPrompt ?? q.comment_prompt,
              hasAnswer: q.hasAnswer ?? q.has_answer,
            })),
          };
        } else if (scene.content.type === 'interactive') {
          scene.content = {
            ...scene.content,
            scientificModel: scene.content.scientificModel ?? (scene.content as any).scientific_model,
          };
        }
      }
      
      return scene;
    });

    // Load chat sessions from independent table
    const chats = await loadChatSessions(stageId);

    log.info(`Loaded stage: ${stageId}, scenes: ${scenes.length}, chats: ${chats.length}`);

    return {
      stage,
      scenes,
      currentSceneId: stage.currentSceneId || scenes[0]?.id || null,
      chats,
    };
  } catch (error) {
    log.error('Failed to load stage:', error);
    return null;
  }
}

/**
 * Delete stage and all related data
 */
export async function deleteStageData(stageId: string): Promise<void> {
  try {
    // Delete stage
    await db.stages.delete(stageId);

    // Delete scenes
    await db.scenes.where('stageId').equals(stageId).delete();

    // Delete chat sessions and playback state
    await deleteChatSessions(stageId);
    await clearPlaybackState(stageId);

    log.info(`Deleted stage: ${stageId}`);
  } catch (error) {
    log.error('Failed to delete stage:', error);
    throw error;
  }
}

/**
 * List all stages
 */
export async function listStages(): Promise<StageListItem[]> {
  try {
    const stages = await db.stages.orderBy('updatedAt').reverse().toArray();

    const stageList: StageListItem[] = await Promise.all(
      stages.map(async (stage) => {
        const sceneCount = await db.scenes.where('stageId').equals(stage.id).count();

        return {
          id: stage.id,
          name: stage.name,
          description: stage.description,
          isDefault: !!stage.isDefault,
          sceneCount,
          createdAt: stage.createdAt,
          updatedAt: stage.updatedAt,
        };
      }),
    );

    return stageList;
  } catch (error) {
    log.error('Failed to list stages:', error);
    return [];
  }
}

/**
 * Get first slide scene's canvas data for each stage (for thumbnail preview).
 * Also resolves gen_img_* placeholders from mediaFiles so thumbnails show real images.
 * Returns a map of stageId -> Slide (canvas data with resolved images)
 */
export async function getFirstSlideByStages(
  stageIds: string[],
): Promise<Record<string, import('../types/slides').Slide>> {
  const result: Record<string, import('../types/slides').Slide> = {};
  try {
    await Promise.all(
      stageIds.map(async (stageId) => {
        const scenes = await db.scenes.where('stageId').equals(stageId).sortBy('order');
        const firstSlide = scenes.find((s) => s.content?.type === 'slide');
        if (firstSlide && firstSlide.content.type === 'slide') {
          const slide = structuredClone(firstSlide.content.canvas);

          // Resolve gen_img_* placeholders from mediaFiles
          const placeholderEls = slide.elements.filter(
             
            (el: any) => el.type === 'image' && /^gen_(img|vid)_[\w-]+$/i.test(el.src as string),
          );
          if (placeholderEls.length > 0) {
            const mediaRecords = await db.mediaFiles.where('stageId').equals(stageId).toArray();
            const mediaMap = new Map(
              mediaRecords.map((r) => {
                // Key format: stageId:elementId → extract elementId
                const elementId = r.id.includes(':') ? r.id.split(':').slice(1).join(':') : r.id;
                return [elementId, r.blob] as const;
              }),
            );
            for (const el of placeholderEls as Array<{ src: string }>) {
              const blob = mediaMap.get(el.src);
              if (blob) {
                el.src = URL.createObjectURL(blob);
              } else {
                // Clear unresolved placeholder so BaseImageElement won't subscribe
                // to the global media store (which may have stale data from another course)
                el.src = '';
              }
            }
          }

          result[stageId] = slide;
        }
      }),
    );
  } catch (error) {
    log.error('Failed to load thumbnails:', error);
  }
  return result;
}

/**
 * Rename a stage (updates only the name field in IndexedDB)
 */
export async function renameStage(stageId: string, newName: string): Promise<void> {
  try {
    await db.stages.update(stageId, { name: newName, updatedAt: Date.now() });
    log.info(`Renamed stage ${stageId} to "${newName}"`);
  } catch (error) {
    log.error('Failed to rename stage:', error);
    throw error;
  }
}

/**
 * Create a new empty stage
 */
export async function createStage(name: string, isDefault = false): Promise<string> {
  try {
    const id = `stage-${Date.now()}`;
    const now = Date.now();
    await db.stages.put({
      id,
      name,
      isDefault,
      createdAt: now,
      updatedAt: now,
    });
    log.info(`Created new stage: ${id} (default=${isDefault})`);
    return id;
  } catch (error) {
    log.error('Failed to create stage:', error);
    throw error;
  }
}

/**
 * Check if stage exists
 */
export async function stageExists(stageId: string): Promise<boolean> {
  try {
    const stage = await db.stages.get(stageId);
    return !!stage;
  } catch (error) {
    log.error('Failed to check stage existence:', error);
    return false;
  }
}
