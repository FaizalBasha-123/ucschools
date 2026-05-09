/**
 * Token Usage Tracking
 *
 * Lightweight server-side utility for tracking LLM token consumption.
 *
 * Usage data is:
 * 1. Logged to the server console (visible in Vercel function logs)
 * 2. Reported to the Rust backend's usage tracking endpoint (if configured)
 *
 * This is intentionally fire-and-forget — token tracking failure must never
 * block or fail a generation request.
 */

import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';
import { backendUrl } from '@/lib/server/backend-url';
import type { NextRequest } from 'next/server';

const log = createLogger('TokenUsage');

export interface TokenUsageRecord {
  /** The model string (e.g. "openrouter:google/gemini-2.5-flash") */
  model: string;
  /** Generation step label (e.g. "scene-outlines-stream", "scene-content") */
  step: string;
  /** Input tokens consumed (prompt tokens) */
  inputTokens: number;
  /** Output tokens generated (completion tokens) */
  outputTokens: number;
  /** Quality mode active at the time of the call */
  qualityMode?: string;
}

/**
 * Report token usage to server logs and optionally to the Rust backend.
 * Always fire-and-forget — never throws.
 */
export function reportTokenUsage(
  req: NextRequest,
  usage: TokenUsageRecord,
): void {
  const totalTokens = usage.inputTokens + usage.outputTokens;

  log.info(
    `[usage] step=${usage.step} model=${usage.model} quality=${usage.qualityMode ?? 'standard'} ` +
      `in=${usage.inputTokens} out=${usage.outputTokens} total=${totalTokens}`,
  );

  // Report to backend asynchronously — don't await
  (async () => {
    try {
      const res = await fetch(`${backendUrl()}/api/internal/usage`, {
        method: 'POST',
        headers: {
          ...authHeadersFrom(req),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: usage.model,
          step: usage.step,
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          quality_mode: usage.qualityMode ?? 'standard',
        }),
      });
      if (!res.ok) {
        // Backend usage route doesn't exist yet — this is expected. Log silently.
        log.info(`[usage] backend not ready (${res.status}) — logged locally only`);
      }
    } catch {
      // Network error or backend unavailable — token usage logged locally is sufficient
    }
  })();
}

/**
 * Extract token counts from AI SDK result objects.
 * Returns zeros if usage data is unavailable.
 */
export function extractTokenCounts(result: {
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
}): { inputTokens: number; outputTokens: number } {
  const u = result.usage;
  if (!u) return { inputTokens: 0, outputTokens: 0 };
  return {
    inputTokens: u.promptTokens ?? u.inputTokens ?? 0,
    outputTokens: u.completionTokens ?? u.outputTokens ?? 0,
  };
}
