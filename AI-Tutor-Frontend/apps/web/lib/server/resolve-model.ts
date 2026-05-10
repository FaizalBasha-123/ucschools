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
 */

import type { NextRequest } from 'next/server';
import { getModel, parseModelString, type ModelWithInfo } from '@/lib/ai/providers';
import { resolveApiKey, resolveBaseUrl, resolveProxy } from '@/lib/server/provider-config';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';

export interface ResolvedModel extends ModelWithInfo {
  /** Original model string (e.g. "openai/gpt-4o-mini") */
  modelString: string;
  /** Effective API key after server-side resolution */
  apiKey: string;
}

/** Map a quality tier to the correct env-var prefix. */
function qualityPrefix(qualityMode?: string): string {
  switch (qualityMode) {
    case 'premium':  return 'PREMIUM_MODE_';
    case 'basic':    return 'BASIC_MODE_';
    default:         return 'STANDARD_MODE_';
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
  const { model, modelInfo } = getModel({
    providerId,
    modelId,
    apiKey,
    baseUrl,
    proxy,
    providerType: params.providerType as 'openai' | 'anthropic' | 'google' | undefined,
    requiresApiKey: params.requiresApiKey,
  });

  return { model, modelInfo, modelString, apiKey };
}

/**
 * Resolve a language model from standard request headers.
 *
 * Reads x-quality-mode to select the correct model tier env-var set.
 * Credential/endpoint overrides are read from x-api-key / x-base-url.
 */
export function resolveModelFromHeaders(req: NextRequest): ResolvedModel {
  return resolveModel({
    modelString: req.headers.get('x-model') || undefined,
    apiKey: req.headers.get('x-api-key') || undefined,
    baseUrl: req.headers.get('x-base-url') || undefined,
    requiresApiKey: req.headers.get('x-requires-api-key') === 'true' ? true : undefined,
    qualityMode: req.headers.get('x-quality-mode') || undefined,
  });
}
