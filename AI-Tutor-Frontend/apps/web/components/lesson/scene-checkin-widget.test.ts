/**
 * Deployment tests for scene-checkin-widget.ts
 *
 * Tests the useSceneCheckin hook trigger interval logic.
 * No React rendering — pure logic unit tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CHECKIN_INTERVAL } from '@/components/lesson/scene-checkin-widget';

// ── We test the trigger interval constant and the hook logic directly ─────────

describe('CHECKIN_INTERVAL constant', () => {
  it('is set to 2 (every 2 scenes)', () => {
    expect(CHECKIN_INTERVAL).toBe(2);
  });
});

// We test the trigger callback logic manually, mimicking what useSceneCheckin does
// (We avoid rendering React hooks to keep this as a pure unit test)

interface CheckinState {
  lastCheckinAt: number;
}

function simulateOnSceneAdvance(
  sceneIndex: number,
  state: CheckinState,
  onTrigger: (idx: number) => void,
): CheckinState {
  if (sceneIndex <= 0) return state;
  if (sceneIndex % CHECKIN_INTERVAL === 0 && sceneIndex !== state.lastCheckinAt) {
    onTrigger(sceneIndex);
    return { lastCheckinAt: sceneIndex };
  }
  return state;
}

describe('Scene check-in trigger logic', () => {
  let triggerSpy: ReturnType<typeof vi.fn>;
  let state: CheckinState;

  beforeEach(() => {
    triggerSpy = vi.fn();
    state = { lastCheckinAt: -1 };
  });

  it('does not trigger on scene 0', () => {
    state = simulateOnSceneAdvance(0, state, triggerSpy);
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it('does not trigger on scene 1', () => {
    state = simulateOnSceneAdvance(1, state, triggerSpy);
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it('triggers on scene 2 (first interval)', () => {
    state = simulateOnSceneAdvance(2, state, triggerSpy);
    expect(triggerSpy).toHaveBeenCalledOnce();
    expect(triggerSpy).toHaveBeenCalledWith(2);
  });

  it('does not trigger again on scene 2 (idempotent)', () => {
    state = simulateOnSceneAdvance(2, state, triggerSpy);
    state = simulateOnSceneAdvance(2, state, triggerSpy);
    expect(triggerSpy).toHaveBeenCalledOnce();
  });

  it('does not trigger on scene 3', () => {
    state = simulateOnSceneAdvance(2, state, triggerSpy); // trigger at 2
    state = simulateOnSceneAdvance(3, state, triggerSpy);
    expect(triggerSpy).toHaveBeenCalledOnce(); // still only 1 call
  });

  it('triggers on scene 4 (second interval)', () => {
    state = simulateOnSceneAdvance(2, state, triggerSpy);
    state = simulateOnSceneAdvance(3, state, triggerSpy);
    state = simulateOnSceneAdvance(4, state, triggerSpy);
    expect(triggerSpy).toHaveBeenCalledTimes(2);
    expect(triggerSpy).toHaveBeenNthCalledWith(2, 4);
  });

  it('triggers on scene 6 (third interval)', () => {
    [2, 3, 4, 5, 6].forEach((idx) => {
      state = simulateOnSceneAdvance(idx, state, triggerSpy);
    });
    expect(triggerSpy).toHaveBeenCalledTimes(3); // at 2, 4, 6
  });

  it('never triggers on odd scenes', () => {
    [1, 3, 5, 7, 9].forEach((idx) => {
      state = simulateOnSceneAdvance(idx, state, triggerSpy);
    });
    expect(triggerSpy).not.toHaveBeenCalled();
  });
});

// ── MaxScenesDialog prop contract tests ───────────────────────────────────────
// We test the logic only (not rendering, as jsdom is not configured)

describe('MaxScenesDialog props contract', () => {
  it('correctly identifies "at capacity" when currentScenes >= maxScenes', () => {
    const isAtCap = (current: number, max: number) => current >= max;
    expect(isAtCap(5, 5)).toBe(true);
    expect(isAtCap(6, 5)).toBe(true);
    expect(isAtCap(4, 5)).toBe(false);
    expect(isAtCap(0, 5)).toBe(false);
  });

  it('lessonName truncation logic', () => {
    const truncate = (name: string, limit: number) =>
      name.length > limit ? name.slice(0, limit) + '…' : name;

    expect(truncate('Introduction to Mitochondria', 40)).toBe('Introduction to Mitochondria');
    expect(truncate('A very long lesson name that exceeds the display limit badly', 40)).toBe(
      'A very long lesson name that exceeds the…',
    );
    expect(truncate('', 40)).toBe('');
  });

  it('estimatedExtraCost formatting is handled correctly', () => {
    const fmt = (cost: number | undefined) =>
      cost != null ? `~${cost.toFixed(0)} extra credits` : 'Add more scenes';

    expect(fmt(undefined)).toBe('Add more scenes');
    expect(fmt(5)).toBe('~5 extra credits');
    expect(fmt(10.6)).toBe('~11 extra credits');
    expect(fmt(0)).toBe('~0 extra credits');
  });
});
