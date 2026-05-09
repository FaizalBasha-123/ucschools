/**
 * POST /api/credits/deduct-lesson
 *
 * Deducts credits for a lesson generated via the client-orchestrated
 * generation-preview pipeline (PATH A). Called fire-and-forget after
 * the first scene is generated and the lesson is saved to IndexedDB.
 *
 * Credit calculation mirrors the Rust backend's `calculate_credit_usage`:
 *   - Base cost determined by quality tier
 *   - Multiplied by learning mode factor
 *   - Estimated from scene count (proxy for content volume)
 *
 * Body:
 *   { lessonId, qualityMode, learningMode, sceneCount, speechCharCount? }
 */

import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { authHeadersFrom } from '@/lib/server/auth';
import { backendUrl } from '@/lib/server/backend-url';

const log = createLogger('CreditDeductLesson');

// ─── Credit tables (mirror ai_tutor_domain::billing) ─────────────────────────

/** Base credits per minute of estimated speech content */
const CREDITS_PER_MINUTE: Record<string, number> = {
  basic: 0.5,
  standard: 1.0,
  premium: 2.0,
};

/** Learning mode multipliers */
const LEARNING_MULTIPLIER: Record<string, number> = {
  explain: 1.0,
  revision: 1.2,
  exam: 1.5,
  placement_prep: 1.8,
};

/**
 * Estimate lesson duration in seconds.
 * Uses speechCharCount when available (accurate), falls back to scene count
 * as a proxy (15 chars/sec speaking rate × 200 chars/scene average).
 */
function estimateDurationSecs(sceneCount: number, speechCharCount?: number): number {
  if (speechCharCount && speechCharCount > 0) {
    return speechCharCount / 15.0;
  }
  // Rough estimate: ~200 spoken chars per scene at 15 chars/sec
  return (sceneCount * 200) / 15.0;
}

function calculateCredits(
  qualityMode: string,
  learningMode: string,
  sceneCount: number,
  speechCharCount?: number,
): number {
  const cpMin = CREDITS_PER_MINUTE[qualityMode] ?? CREDITS_PER_MINUTE.standard;
  const multiplier = LEARNING_MULTIPLIER[learningMode] ?? LEARNING_MULTIPLIER.explain;
  const durationSecs = estimateDurationSecs(sceneCount, speechCharCount);
  const durationMins = durationSecs / 60.0;
  return parseFloat((durationMins * cpMin * multiplier).toFixed(4));
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      lessonId,
      qualityMode = 'standard',
      learningMode = 'explain',
      sceneCount = 1,
      speechCharCount,
    } = body as {
      lessonId?: string;
      qualityMode?: string;
      learningMode?: string;
      sceneCount?: number;
      speechCharCount?: number;
    };

    if (!lessonId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'lessonId is required');
    }

    const credits = calculateCredits(qualityMode, learningMode, sceneCount, speechCharCount);

    if (credits <= 0) {
      // Nothing to deduct
      return apiSuccess({ debited: 0, lessonId });
    }

    log.info(
      `Deducting ${credits.toFixed(4)} credits for lesson "${lessonId}" ` +
        `[quality=${qualityMode}, learning=${learningMode}, scenes=${sceneCount}]`,
    );

    // Call the Rust backend's credit debit endpoint
    const backendRes = await fetch(`${backendUrl()}/api/credits/debit`, {
      method: 'POST',
      headers: {
        ...authHeadersFrom(req),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: credits,
        reason: `lesson:${lessonId} quality=${qualityMode} learning=${learningMode} scenes=${sceneCount}`,
        idempotency_key: `lesson-debit-${lessonId}`,
      }),
    });

    if (!backendRes.ok) {
      const errText = await backendRes.text().catch(() => '');
      log.error(`Credit debit failed for lesson "${lessonId}": ${backendRes.status} ${errText}`);
      // Return a non-fatal error — the lesson is already generated, don't block the user
      return apiError(
        'INTERNAL_ERROR',
        backendRes.status,
        'Credit deduction failed — balance may be stale',
        errText,
      );
    }

    log.info(`Successfully debited ${credits.toFixed(4)} credits for lesson "${lessonId}"`);
    return apiSuccess({ debited: credits, lessonId });
  } catch (error) {
    log.error('Credit deduction failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Credit deduction failed',
    );
  }
}
