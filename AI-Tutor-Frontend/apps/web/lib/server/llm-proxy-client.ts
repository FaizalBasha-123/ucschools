import { createLogger } from '@/lib/logger';

const log = createLogger('LLMProxyClient');

const PROXY_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;

export function getProxyUrl(): string | undefined {
  return process.env.AI_TUTOR_PROXY_URL || undefined;
}

export function assertProxyConfigured(): string {
  const url = getProxyUrl();
  if (!url) {
    throw new Error(
      'AI_TUTOR_PROXY_URL is not configured. ' +
      'This endpoint requires the Rust backend proxy for LLM generation.',
    );
  }
  return url;
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

export interface ProxyGenerateParams {
  model?: string;
  task?: string;
  quality_mode?: string;
  learning_mode?: string;
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

export async function proxyGenerateText(
  params: ProxyGenerateParams,
): Promise<ProxyGenerateResult> {
  const proxyUrl = assertProxyConfigured();
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

export async function* proxyStreamText(
  params: ProxyGenerateParams,
): AsyncGenerator<ProxyStreamEvent> {
  const proxyUrl = assertProxyConfigured();
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

export function buildProxyParams(
  task: string,
  systemPrompt: string,
  userPrompt: string,
  overrides?: {
    qualityMode?: string;
    learningMode?: string;
    apiKey?: string;
    baseUrl?: string;
    providerType?: string;
    requiresApiKey?: boolean;
    maxTokens?: number;
  },
): ProxyGenerateParams {
  return {
    task,
    quality_mode: overrides?.qualityMode,
    learning_mode: overrides?.learningMode,
    system_prompt: systemPrompt,
    user_prompt: userPrompt,
    api_key: overrides?.apiKey,
    base_url: overrides?.baseUrl,
    provider_type: overrides?.providerType,
    requires_api_key: overrides?.requiresApiKey,
    max_tokens: overrides?.maxTokens,
  };
}
