/**
 * POST /api/credits/deduct-lesson
 *
 * Deducts credits for a lesson generated via the client-orchestrated
 * generation-preview pipeline (PATH A). Called fire-and-forget after
 * the first scene is generated and the lesson is saved to IndexedDB.
 *
 * Credit calculation mirrors the Rust backend's `lesson_credits_fixed`:
 *   - Fixed matrix lookup by quality + learning mode
 *   - NOT duration-based
 *
 * Body:
 *   { lessonId, qualityMode, learningMode }
 */

import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { authHeadersFrom } from '@/lib/server/auth';
import { backendUrl } from '@/lib/server/backend-url';

const log = createLogger('CreditDeductLesson');

// ─── Fixed lesson credit matrix (mirror ai_tutor_domain::billing) ─────────────

const LESSON_CREDITS_FIXED: Record<string, Record<string, number>> = {
  basic: {
    revision: 1.2,
    explain: 2.0,
    exam: 3.0,
    placement_prep: 4.0,
  },
  standard: {
    revision: 2.0,
    explain: 4.0,
    exam: 5.0,
    placement_prep: 6.0,
  },
  premium: {
    revision: 3.5,
    explain: 6.0,
    exam: 7.0,
    placement_prep: 9.0,
  },
};

function calculateCredits(qualityMode: string, learningMode: string): number {
  const byQuality = LESSON_CREDITS_FIXED[qualityMode];
  if (!byQuality) return 4.0; // fallback: Standard Explain
  return byQuality[learningMode] ?? 4.0;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      lessonId,
      qualityMode = 'standard',
      learningMode = 'explain',
    } = body as {
      lessonId?: string;
      qualityMode?: string;
      learningMode?: string;
    };

    if (!lessonId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'lessonId is required');
    }

    const credits = calculateCredits(qualityMode, learningMode);

    if (credits <= 0) {
      // Nothing to deduct
      return apiSuccess({ debited: 0, lessonId });
    }

    log.info(
      `Deducting ${credits.toFixed(4)} credits for lesson "${lessonId}" ` +
        `[quality=${qualityMode}, learning=${learningMode}]`,
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
        reason: `lesson:${lessonId} quality=${qualityMode} learning=${learningMode}`,
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
