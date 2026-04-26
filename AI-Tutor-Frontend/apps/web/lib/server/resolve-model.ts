/**
 * Shared model resolution utilities for API routes.
 *
 * Extracts the repeated parseModelString → resolveApiKey → resolveBaseUrl →
 * resolveProxy → getModel boilerplate into a single call.
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

/**
 * Resolve a language model from explicit parameters.
 *
 * Use this when model config comes from the request body or headers.
 * When generationMode is 'best', resolves from BEST_MODE_ env vars.
 * Otherwise defaults to BALANCED_MODE_ env vars.
 */
export function resolveModel(params: {
  modelString?: string;
  apiKey?: string;
  baseUrl?: string;
  providerType?: string;
  requiresApiKey?: boolean;
  generationMode?: string;
}): ResolvedModel {
  const prefix = params.generationMode === 'best' ? 'BEST_MODE_' : 'BALANCED_MODE_';
  const modelString =
    params.modelString ||
    process.env[`${prefix}AI_TUTOR_CHAT_SCAFFOLD_MODEL`] ||
    process.env.BALANCED_MODE_AI_TUTOR_CHAT_SCAFFOLD_MODEL;
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
 * The backend owns the active model selection.
 * Reads only credential and endpoint overrides from headers.
 * Passes through x-generation-mode so the correct BALANCED_MODE_/BEST_MODE_
 * env var set is used for the frontend generation pipeline.
 */
export function resolveModelFromHeaders(req: NextRequest): ResolvedModel {
  return resolveModel({
    apiKey: req.headers.get('x-api-key') || undefined,
    baseUrl: req.headers.get('x-base-url') || undefined,
    requiresApiKey: req.headers.get('x-requires-api-key') === 'true' ? true : undefined,
    generationMode: req.headers.get('x-generation-mode') || undefined,
  });
}
