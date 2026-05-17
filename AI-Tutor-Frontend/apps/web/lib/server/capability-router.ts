/**
 * Capability-based model router.
 *
 * Replaces per-tier env-var selection with capability-based routing.
 * Each generation task maps to a base capability, which can be escalated
 * based on learning mode (exam/placement_prep → bump up, revision → bump down).
 *
 * Resolution priority:
 *   1. Explicit model override (from headers or params)
 *   2. Task-specific env var: {QUALITY}MODE_AI_TUTOR_GENERATION_{TASK}_MODEL
 *   3. Capability env var: MODEL_CAPABILITY_{CAP}
 *   4. MODEL_DEFAULT env var
 *   5. Legacy fallback: STANDARD_MODE_AI_TUTOR_CHAT_SCAFFOLD_MODEL
 */

import type { NextRequest } from 'next/server';
import {
  parseModelString,
  getModel,
  type ModelWithInfo,
} from '@/lib/ai/providers';
import {
  resolveApiKey,
  resolveBaseUrl,
  resolveProxy,
  getProviderType,
} from '@/lib/server/provider-config';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';
import type { GenerationTask } from '@/lib/server/resolve-model';
import { effectiveQualityTier, qualityPrefix, taskEnvSuffix } from '@/lib/server/resolve-model';

export type Capability =
  | 'FAST_CHEAP'
  | 'STRUCTURED_GENERATION'
  | 'PREMIUM_REASONING'
  | 'LIGHTWEIGHT_EVALUATION';

/** Order for capability escalation/demotion (index = rank). */
const CAPABILITY_ORDER: Capability[] = [
  'FAST_CHEAP',
  'STRUCTURED_GENERATION',
  'PREMIUM_REASONING',
];

/** Base capability per generation task. */
const TASK_CAPABILITY: Record<GenerationTask, Capability> = {
  'outlines': 'STRUCTURED_GENERATION',
  'scene-content': 'STRUCTURED_GENERATION',
  'scene-actions': 'FAST_CHEAP',
  'quiz-grade': 'LIGHTWEIGHT_EVALUATION',
};

/** Map capability to its MODEL_CAPABILITY_* env var name. */
function capabilityEnvVar(cap: Capability): string {
  return `MODEL_CAPABILITY_${cap}`;
}

export interface ResolvedCapabilityModel extends ModelWithInfo {
  modelString: string;
  apiKey: string;
  capability: Capability;
}

interface ResolveCapabilityParams {
  task: GenerationTask;
  qualityMode?: string;
  learningMode?: string;
  explicitModel?: string;
  apiKey?: string;
  baseUrl?: string;
  providerType?: string;
  requiresApiKey?: boolean;
}

/**
 * Escalate/demote capability based on learning mode.
 *
 * exam / placement_prep → bump up one level
 * revision              → bump down one level
 * explain               → no change
 */
function escalateCapability(base: Capability, learningMode: string): Capability {
  switch (learningMode) {
    case 'exam':
    case 'placement_prep': {
      if (base === 'FAST_CHEAP') return 'STRUCTURED_GENERATION';
      if (base === 'STRUCTURED_GENERATION') return 'PREMIUM_REASONING';
      return base;
    }
    case 'revision': {
      if (base === 'PREMIUM_REASONING') return 'STRUCTURED_GENERATION';
      if (base === 'STRUCTURED_GENERATION') return 'FAST_CHEAP';
      return base;
    }
    case 'explain':
    default:
      return base;
  }
}

/**
 * Resolve a model string using the capability-based routing chain.
 *
 * Priority:
 *   1. explicitModel (user override)
 *   2. {effectiveQuality}MODE_AI_TUTOR_GENERATION_{TASK}_MODEL (task-specific)
 *   3. MODEL_CAPABILITY_{capability} (capability-based)
 *   4. MODEL_DEFAULT (ultimate fallback)
 *   5. STANDARD_MODE_AI_TUTOR_CHAT_SCAFFOLD_MODEL (legacy fallback)
 */
export function resolveCapabilityModelString(params: {
  task: GenerationTask;
  qualityMode: string;
  learningMode: string;
  explicitModel?: string;
}): { modelString: string; capability: Capability } {
  const { task, qualityMode, learningMode, explicitModel } = params;

  // Priority 1: Explicit model override
  if (explicitModel) {
    return { modelString: explicitModel, capability: TASK_CAPABILITY[task] };
  }

  const effectiveQuality = effectiveQualityTier(qualityMode, learningMode);
  const prefix = qualityPrefix(effectiveQuality);
  const taskSuffix = taskEnvSuffix(task);

  // Priority 2: Task-specific env var
  const taskVar = `${prefix}AI_TUTOR_${taskSuffix}_MODEL`;
  const taskModel = process.env[taskVar];
  if (taskModel) {
    return { modelString: taskModel, capability: TASK_CAPABILITY[task] };
  }

  const baseCap = TASK_CAPABILITY[task];
  const effectiveCap = escalateCapability(baseCap, learningMode);

  // Priority 3: Capability env var
  const capVar = capabilityEnvVar(effectiveCap);
  const capModel = process.env[capVar];
  if (capModel) {
    return { modelString: capModel, capability: effectiveCap };
  }

  // Priority 4: MODEL_DEFAULT
  const defaultModel = process.env.MODEL_DEFAULT;
  if (defaultModel) {
    return { modelString: defaultModel, capability: effectiveCap };
  }

  // Priority 5: Legacy fallback
  const legacyModel = process.env.STANDARD_MODE_AI_TUTOR_CHAT_SCAFFOLD_MODEL;
  if (legacyModel) {
    return { modelString: legacyModel, capability: effectiveCap };
  }

  throw new Error(
    `No model configured for task "${task}". ` +
    `Set MODEL_CAPABILITY_${effectiveCap}, MODEL_DEFAULT, or legacy env vars.`,
  );
}

/**
 * Resolve a full model (apiKey, baseUrl, provider) using capability routing.
 *
 * Use this in API routes that want capability-based model selection.
 */
export function resolveCapabilityModel(
  params: ResolveCapabilityParams,
): ResolvedCapabilityModel {
  const {
    task,
    qualityMode = 'standard',
    learningMode = 'explain',
    explicitModel,
    apiKey,
    baseUrl,
    providerType,
    requiresApiKey,
  } = params;

  const { modelString, capability } = resolveCapabilityModelString({
    task,
    qualityMode,
    learningMode,
    explicitModel,
  });

  const { providerId, modelId } = parseModelString(modelString);

  if (baseUrl && process.env.NODE_ENV === 'production') {
    const ssrfError = validateUrlForSSRF(baseUrl);
    if (ssrfError) {
      throw new Error(ssrfError);
    }
  }

  const resolvedApiKey = baseUrl
    ? apiKey || ''
    : resolveApiKey(providerId, apiKey || '');
  const resolvedBaseUrl = baseUrl || resolveBaseUrl(providerId);
  const proxy = resolveProxy(providerId);
  const VALID_PROVIDER_TYPES = new Set(['openai', 'anthropic', 'google']);
  const clientType = providerType as string | undefined;
  const effectiveProviderType = (
    clientType && VALID_PROVIDER_TYPES.has(clientType) ? clientType : undefined
  ) || getProviderType(providerId);

  const { model, modelInfo } = getModel({
    providerId,
    modelId,
    apiKey: resolvedApiKey,
    baseUrl: resolvedBaseUrl,
    proxy,
    providerType: effectiveProviderType as 'openai' | 'anthropic' | 'google' | undefined,
    requiresApiKey,
  });

  return { model, modelInfo, modelString, apiKey: resolvedApiKey, capability };
}

/**
 * Resolve capability model from NextRequest headers.
 *
 * Reads standard headers (x-quality-mode, x-learning-mode, x-model, etc.)
 * and delegates to resolveCapabilityModel.
 */
export function resolveCapabilityModelFromRequest(
  req: NextRequest,
  task: GenerationTask,
): ResolvedCapabilityModel {
  return resolveCapabilityModel({
    task,
    qualityMode: req.headers.get('x-quality-mode') || 'standard',
    learningMode: req.headers.get('x-learning-mode') || 'explain',
    explicitModel: req.headers.get('x-model') || undefined,
    apiKey: req.headers.get('x-api-key') || undefined,
    baseUrl: req.headers.get('x-base-url') || undefined,
    providerType: req.headers.get('x-provider-type') || undefined,
    requiresApiKey: req.headers.get('x-requires-api-key') === 'true' ? true : undefined,
  });
}
