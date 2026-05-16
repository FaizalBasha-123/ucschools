/**
 * Shared model resolution utilities for API routes.
 *
 * Extracts the repeated parseModelString → resolveApiKey → resolveBaseUrl →
 * resolveProxy → getModel boilerplate into a single call.
 *
 * Quality tiers map to env-var prefixes:
 *   basic    → BASIC_MODE_AI_TUTOR_CHAT_SCAFFOLD_MODEL
 *   standard → STANDARD_MODE_AI_TUTOR_CHAT_SCAFFOLD_MODEL  (default)
 *   premium  → PREMIUM_MODE_AI_TUTOR_CHAT_SCAFFOLD_MODEL
 *
 * Per-task model selection:
 *   Each generation phase (outlines, scene-content, scene-actions, agent-profiles)
 *   can use a different model via task-specific env vars:
 *   {QUALITY}MODE_AI_TUTOR_GENERATION_{TASK}_MODEL
 *
 * Learning mode adjusts the effective quality tier:
 *   exam/placement_prep → bump up (basic→standard, standard→premium)
 *   revision            → bump down (premium→standard, standard→basic)
 *   explain             → use quality tier as-is
 */

import type { NextRequest } from 'next/server';
import { getModel, parseModelString, type ModelWithInfo } from '@/lib/ai/providers';
import { resolveApiKey, resolveBaseUrl, resolveProxy, getProviderType } from '@/lib/server/provider-config';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';

export interface ResolvedModel extends ModelWithInfo {
  /** Original model string (e.g. "openai/gpt-4o-mini") */
  modelString: string;
  /** Effective API key after server-side resolution */
  apiKey: string;
}

/** Generation task identifiers for per-task model selection */
export type GenerationTask = 'outlines' | 'scene-content' | 'scene-actions' | 'agent-profiles';

/** Map a quality tier to the correct env-var prefix. */
function qualityPrefix(qualityMode?: string): string {
  switch (qualityMode) {
    case 'premium':  return 'PREMIUM_MODE_';
    case 'basic':    return 'BASIC_MODE_';
    default:         return 'STANDARD_MODE_';
  }
}

/** Map a generation task to its env-var suffix. */
function taskEnvSuffix(task: GenerationTask): string {
  switch (task) {
    case 'outlines':       return 'GENERATION_OUTLINES';
    case 'scene-content':  return 'GENERATION_SCENE_CONTENT';
    case 'scene-actions':  return 'GENERATION_SCENE_ACTIONS';
    case 'agent-profiles': return 'GENERATION_AGENT_PROFILES';
  }
}

/**
 * Map learning mode to effective quality tier for model selection.
 *
 * Learning modes that demand higher accuracy (exam, placement_prep)
 * bump the tier up. Lighter modes (revision) bump it down.
 */
export function effectiveQualityTier(qualityMode: string, learningMode: string): string {
  switch (learningMode) {
    case 'exam':
    case 'placement_prep':
      if (qualityMode === 'basic') return 'standard';
      if (qualityMode === 'standard') return 'premium';
      return 'premium';
    case 'revision':
      if (qualityMode === 'premium') return 'standard';
      if (qualityMode === 'standard') return 'basic';
      return 'basic';
    case 'explain':
    default:
      return qualityMode;
  }
}

/**
 * Resolve a language model from explicit parameters.
 *
 * Use this when model config comes from the request body or headers.
 * qualityMode selects the env-var tier:
 *   basic    → BASIC_MODE_AI_TUTOR_CHAT_SCAFFOLD_MODEL
 *   standard → STANDARD_MODE_AI_TUTOR_CHAT_SCAFFOLD_MODEL (default)
 *   premium  → PREMIUM_MODE_AI_TUTOR_CHAT_SCAFFOLD_MODEL
 */
export function resolveModel(params: {
  modelString?: string;
  apiKey?: string;
  baseUrl?: string;
  providerType?: string;
  requiresApiKey?: boolean;
  qualityMode?: string;
}): ResolvedModel {
  const prefix = qualityPrefix(params.qualityMode);
  const modelString =
    params.modelString ||
    process.env[`${prefix}AI_TUTOR_CHAT_SCAFFOLD_MODEL`] ||
    process.env.STANDARD_MODE_AI_TUTOR_CHAT_SCAFFOLD_MODEL;
  if (!modelString) {
    throw new Error(
      `${prefix}AI_TUTOR_CHAT_SCAFFOLD_MODEL environment variable is required but not set.`,
    );
  }
  const { providerId, modelId } = parseModelString(modelString);

  const clientBaseUrl = params.baseUrl || undefined;
  if (clientBaseUrl && process.env.NODE_ENV === 'production') {
    const ssrfError = validateUrlForSSRF(clientBaseUrl);
    if (ssrfError) {
      throw new Error(ssrfError);
    }
  }

  const apiKey = clientBaseUrl
    ? params.apiKey || ''
    : resolveApiKey(providerId, params.apiKey || '');
  const baseUrl = clientBaseUrl ? clientBaseUrl : resolveBaseUrl(providerId, params.baseUrl);
  const proxy = resolveProxy(providerId);
  const VALID_PROVIDER_TYPES = new Set(['openai', 'anthropic', 'google']);
  const clientType = params.providerType as string | undefined;
  const effectiveProviderType = (
    clientType && VALID_PROVIDER_TYPES.has(clientType) ? clientType : undefined
  ) || getProviderType(providerId);
  const { model, modelInfo } = getModel({
    providerId,
    modelId,
    apiKey,
    baseUrl,
    proxy,
    providerType: effectiveProviderType as 'openai' | 'anthropic' | 'google' | undefined,
    requiresApiKey: params.requiresApiKey,
  });

  return { model, modelInfo, modelString, apiKey };
}

/**
 * Resolve a language model for a specific generation task, using
 * quality mode and learning mode from request headers.
 *
 * Resolution priority:
 *   1. If `x-model` header is explicitly set (user override in settings), use it directly.
 *   2. Try task-specific env var: {effectiveQuality}MODE_AI_TUTOR_GENERATION_{TASK}_MODEL
 *   3. Fall back to generic: {effectiveQuality}MODE_AI_TUTOR_CHAT_SCAFFOLD_MODEL
 *   4. Fall back to STANDARD_MODE_AI_TUTOR_CHAT_SCAFFOLD_MODEL
 *
 * Learning mode adjusts the effective quality tier:
 *   exam/placement_prep → bump up (basic→standard, standard→premium)
 *   revision            → bump down (premium→standard, standard→basic)
 */
export function resolveModelForTask(
  req: NextRequest,
  task: GenerationTask,
): ResolvedModel {
  const qualityMode = req.headers.get('x-quality-mode') || 'standard';
  const learningMode = req.headers.get('x-learning-mode') || 'explain';
  const explicitModel = req.headers.get('x-model');

  // Priority 1: Explicit model override from user settings
  if (explicitModel) {
    return resolveModel({
      modelString: explicitModel,
      apiKey: req.headers.get('x-api-key') || undefined,
      baseUrl: req.headers.get('x-base-url') || undefined,
      providerType: req.headers.get('x-provider-type') || undefined,
      requiresApiKey: req.headers.get('x-requires-api-key') === 'true' ? true : undefined,
      qualityMode,
    });
  }

  // Determine effective tier from quality + learning mode
  const effectiveQuality = effectiveQualityTier(qualityMode, learningMode);
  const prefix = qualityPrefix(effectiveQuality);
  const taskSuffix = taskEnvSuffix(task);

  // Priority 2: Task-specific env var
  const taskVar = `${prefix}AI_TUTOR_${taskSuffix}_MODEL`;
  const taskModel = process.env[taskVar];
  if (taskModel) {
    return resolveModel({
      modelString: taskModel,
      apiKey: req.headers.get('x-api-key') || undefined,
      baseUrl: req.headers.get('x-base-url') || undefined,
      providerType: req.headers.get('x-provider-type') || undefined,
      requiresApiKey: req.headers.get('x-requires-api-key') === 'true' ? true : undefined,
      qualityMode: effectiveQuality,
    });
  }

  // Priority 3 & 4: Fall back to generic scaffold model
  return resolveModel({
    apiKey: req.headers.get('x-api-key') || undefined,
    baseUrl: req.headers.get('x-base-url') || undefined,
    providerType: req.headers.get('x-provider-type') || undefined,
    requiresApiKey: req.headers.get('x-requires-api-key') === 'true' ? true : undefined,
    qualityMode: effectiveQuality,
  });
}

/**
 * Resolve a language model from standard request headers.
 *
 * Reads x-quality-mode to select the correct model tier env-var set.
 * Credential/endpoint overrides are read from x-api-key / x-base-url.
 *
 * @deprecated Use resolveModelForTask(req, task) for per-task model selection.
 */
export function resolveModelFromHeaders(req: NextRequest): ResolvedModel {
  return resolveModel({
    modelString: req.headers.get('x-model') || undefined,
    apiKey: req.headers.get('x-api-key') || undefined,
    baseUrl: req.headers.get('x-base-url') || undefined,
    providerType: req.headers.get('x-provider-type') || undefined,
    requiresApiKey: req.headers.get('x-requires-api-key') === 'true' ? true : undefined,
    qualityMode: req.headers.get('x-quality-mode') || undefined,
  });
}
