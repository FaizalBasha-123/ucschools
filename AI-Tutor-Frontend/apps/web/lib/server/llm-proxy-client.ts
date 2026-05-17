/**
 * LLM Proxy Client
 *
 * Sends pre-built prompts to the Rust backend proxy instead of
 * calling LLM providers directly. Enabled via AI_TUTOR_PROXY_URL env var.
 *
 * The proxy handles model resolution, API key injection, and provider
 * routing on the Rust side.
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('LLMProxyClient');

const PROXY_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;

export function getProxyUrl(): string | undefined {
  return process.env.AI_TUTOR_PROXY_URL || undefined;
}

async function proxyFetch(url: string, options?: RequestInit & { timeout?: number }, retries = MAX_RETRIES): Promise<Response> {
  const timeout = options?.timeout ?? PROXY_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const signal = options?.signal ? combineAbortSignals(options.signal, controller.signal) : controller.signal;

  try {
    const response = await fetch(url, { ...options, signal });
    clearTimeout(timeoutId);

    if (response.status >= 500 && retries > 0) {
      log.warn(`Proxy returned ${response.status}, retrying... (${retries} left)`);
      await new Promise(r => setTimeout(r, 1000));
      return proxyFetch(url, options, retries - 1);
    }

    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (retries > 0) {
      log.warn(`Proxy fetch failed (${err}), retrying... (${retries} left)`);
      await new Promise(r => setTimeout(r, 1000));
      return proxyFetch(url, options, retries - 1);
    }
    throw err;
  }
}

function combineAbortSignals(s1: AbortSignal, s2: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  s1.addEventListener('abort', onAbort);
  s2.addEventListener('abort', onAbort);
  if (s1.aborted || s2.aborted) controller.abort();
  return controller.signal;
}

export function isProxyEnabled(): boolean {
  return !!getProxyUrl();
}

export interface ProxyGenerateParams {
  model: string;
  system_prompt: string;
  user_prompt: string;
  api_key?: string;
  base_url?: string;
  provider_type?: string;
  requires_api_key?: boolean;
  max_tokens?: number;
}

export interface ProxyGenerateResult {
  text: string;
  model: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens?: number;
    source: string;
  } | null;
}

export interface ProxyStreamEvent {
  type: 'delta' | 'done' | 'error';
  text?: string;
  full_text?: string;
  error?: string;
}

export class LlmProxyError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'LlmProxyError';
  }
}

/**
 * Generate text via Rust proxy (non-streaming).
 */
export async function proxyGenerateText(
  params: ProxyGenerateParams,
): Promise<ProxyGenerateResult> {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) {
    throw new LlmProxyError('AI_TUTOR_PROXY_URL is not configured');
  }

  const url = `${proxyUrl.replace(/\/$/, '')}/api/generate/llm`;

  const response = await proxyFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown');
    throw new LlmProxyError(
      `Proxy returned ${response.status}: ${errorBody}`,
      response.status,
    );
  }

  return response.json() as Promise<ProxyGenerateResult>;
}

/**
 * Stream text via Rust proxy (SSE).
 *
 * Returns an async generator that yields ProxyStreamEvent objects.
 */
export async function* proxyStreamText(
  params: ProxyGenerateParams,
): AsyncGenerator<ProxyStreamEvent> {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) {
    throw new LlmProxyError('AI_TUTOR_PROXY_URL is not configured');
  }

  const url = `${proxyUrl.replace(/\/$/, '')}/api/generate/llm/stream`;

  const response = await proxyFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown');
    throw new LlmProxyError(
      `Proxy stream returned ${response.status}: ${errorBody}`,
      response.status,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new LlmProxyError('No response body from proxy stream');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            yield event as ProxyStreamEvent;
          } catch {
            // skip malformed events
          }
        }
      }
    }

    // Process remaining buffer
    if (buffer.startsWith('data: ')) {
      try {
        const event = JSON.parse(buffer.slice(6));
        yield event as ProxyStreamEvent;
      } catch {
        // skip malformed
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Build proxy params from a resolved model and prompt strings.
 */
export function buildProxyParams(
  modelString: string,
  systemPrompt: string,
  userPrompt: string,
  overrides?: {
    apiKey?: string;
    baseUrl?: string;
    providerType?: string;
    requiresApiKey?: boolean;
    maxTokens?: number;
  },
): ProxyGenerateParams {
  return {
    model: modelString,
    system_prompt: systemPrompt,
    user_prompt: userPrompt,
    api_key: overrides?.apiKey,
    base_url: overrides?.baseUrl,
    provider_type: overrides?.providerType,
    requires_api_key: overrides?.requiresApiKey,
    max_tokens: overrides?.maxTokens,
  };
}

/**
 * Fetch deterministic profiles from the proxy.
 */
export async function fetchProfiles(
  qualityMode: string,
  learningMode: string,
): Promise<{
  learning_profile: string;
  persona_profile: string;
  layout_profile: string;
  pacing_profile: string;
}> {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) {
    throw new LlmProxyError('AI_TUTOR_PROXY_URL is not configured');
  }

  const url = `${proxyUrl.replace(/\/$/, '')}/api/generate/profiles?quality_mode=${encodeURIComponent(qualityMode)}&learning_mode=${encodeURIComponent(learningMode)}`;

  const response = await proxyFetch(url);
  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown');
    throw new LlmProxyError(
      `Profiles endpoint returned ${response.status}: ${errorBody}`,
      response.status,
    );
  }

  return response.json();
}

/**
 * Create a proxy-aware aiCall function.
 *
 * If AI_TUTOR_PROXY_URL is configured, sends prompts to the Rust proxy.
 * Otherwise uses the provided directAiCall function as fallback.
 */
export function createProxyAwareAiCall(
  modelString: string,
  directAiCall: (
    systemPrompt: string,
    userPrompt: string,
    images?: Array<{ id: string; src: string }>,
  ) => Promise<string>,
  overrides?: {
    apiKey?: string;
    baseUrl?: string;
    providerType?: string;
    requiresApiKey?: boolean;
    maxTokens?: number;
  },
): (systemPrompt: string, userPrompt: string, images?: Array<{ id: string; src: string }>) => Promise<string> {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return directAiCall;

  return async (systemPrompt: string, userPrompt: string, _images?: Array<{ id: string; src: string }>) => {
    const result = await proxyGenerateText(
      buildProxyParams(modelString, systemPrompt, userPrompt, overrides),
    );
    return result.text;
  };
}
