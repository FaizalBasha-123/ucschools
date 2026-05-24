/**
 * Deployment tests for media-orchestrator.ts
 *
 * These are UNIT tests — they don't hit real APIs.
 * They verify the gating and dispatching logic works correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── We mock the stores and fetch before importing the module ──────────────────
const mockGetTask = vi.fn();
const mockEnqueueTasks = vi.fn();
const mockMarkGenerating = vi.fn();
const mockMarkDone = vi.fn();
const mockMarkFailed = vi.fn();
const mockMarkPendingForRetry = vi.fn();

vi.mock('@/lib/store/media-generation', () => ({
  useMediaGenerationStore: {
    getState: () => ({
      getTask: mockGetTask,
      enqueueTasks: mockEnqueueTasks,
      markGenerating: mockMarkGenerating,
      markDone: mockMarkDone,
      markFailed: mockMarkFailed,
      markPendingForRetry: mockMarkPendingForRetry,
    }),
  },
}));

vi.mock('@/lib/utils/database', () => ({
  db: {
    mediaFiles: {
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  },
  mediaFileKey: (stageId: string, elementId: string) => `${stageId}:${elementId}`,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  }),
}));

// Settings store — we control imageGenerationEnabled and videoGenerationEnabled
let imageGenerationEnabled = true;
let videoGenerationEnabled = false;

vi.mock('@/lib/store/settings', () => ({
  useSettingsStore: {
    getState: () => ({
      imageGenerationEnabled,
      videoGenerationEnabled,
      imageProviderId: 'seedream',
      imageModelId: 'doubao-seedream-5-0-260128',
      imageProvidersConfig: {
        seedream: { apiKey: 'test-key', baseUrl: 'https://example.api' },
      },
      videoProviderId: 'mock-video',
      videoProvidersConfig: {},
    }),
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { generateMediaForOutlines, retryMediaTask } from '@/lib/media/media-orchestrator';
import type { SceneOutline } from '@/lib/types/generation';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOutline(overrides?: Partial<SceneOutline>): SceneOutline {
  return {
    id: 'outline-1',
    title: 'Mitochondria Structure',
    description: 'The powerhouse of the cell',
    keyPoints: ['Outer membrane', 'Inner membrane', 'ATP synthesis'],
    sceneType: 'slide',
    mediaGenerations: [
      {
        elementId: 'gen_img_1',
        type: 'image',
        prompt: 'Detailed mitochondria cross-section diagram',
        aspectRatio: '16:9',
      },
    ],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('generateMediaForOutlines — image gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imageGenerationEnabled = true;
    videoGenerationEnabled = false;
    mockGetTask.mockReturnValue(null); // no existing task
  });

  it('skips image generation when imageGenerationEnabled is false', async () => {
    imageGenerationEnabled = false;
    const outlines = [makeOutline()];
    await generateMediaForOutlines(outlines, 'stage-1');
    expect(mockEnqueueTasks).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips video requests when videoGenerationEnabled is false', async () => {
    videoGenerationEnabled = false;
    const outlines = [
      makeOutline({
        mediaGenerations: [
          {
            elementId: 'gen_vid_1',
            type: 'video',
            prompt: 'Mitochondria animation',
            aspectRatio: '16:9',
          },
        ],
      }),
    ];
    await generateMediaForOutlines(outlines, 'stage-1');
    expect(mockEnqueueTasks).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips already-done tasks to avoid re-generation', async () => {
    mockGetTask.mockReturnValue({ status: 'done' });
    const outlines = [makeOutline()];
    await generateMediaForOutlines(outlines, 'stage-1');
    expect(mockEnqueueTasks).not.toHaveBeenCalled();
  });

  it('skips already-failed tasks to avoid re-generation', async () => {
    mockGetTask.mockReturnValue({ status: 'failed' });
    const outlines = [makeOutline()];
    await generateMediaForOutlines(outlines, 'stage-1');
    expect(mockEnqueueTasks).not.toHaveBeenCalled();
  });

  it('enqueues and attempts image API call for valid pending task', async () => {
    mockGetTask.mockReturnValue(null);
    // Mock a successful image API response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        result: { url: 'data:image/png;base64,abc123' },
      }),
      blob: async () => new Blob([''], { type: 'image/png' }),
    } as Response);

    const outlines = [makeOutline()];
    await generateMediaForOutlines(outlines, 'stage-1');

    expect(mockEnqueueTasks).toHaveBeenCalledOnce();
    expect(mockMarkGenerating).toHaveBeenCalledWith('gen_img_1');
  });

  it('handles outlines with no mediaGenerations gracefully', async () => {
    const outlines = [makeOutline({ mediaGenerations: [] })];
    await generateMediaForOutlines(outlines, 'stage-1');
    expect(mockEnqueueTasks).not.toHaveBeenCalled();
  });

  it('handles outlines with undefined mediaGenerations', async () => {
    const outlines = [makeOutline({ mediaGenerations: undefined as any })] ;
    await generateMediaForOutlines(outlines, 'stage-1');
    expect(mockEnqueueTasks).not.toHaveBeenCalled();
  });

  it('processes multiple outlines and enqueues all valid requests', async () => {
    mockGetTask.mockReturnValue(null);
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, result: { url: 'data:image/png;base64,aaa' } }),
        blob: async () => new Blob([], { type: 'image/png' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, result: { url: 'data:image/png;base64,bbb' } }),
        blob: async () => new Blob([], { type: 'image/png' }),
      } as Response);

    const outlines = [
      makeOutline({ mediaGenerations: [{ elementId: 'img-a', type: 'image', prompt: 'A' }] }),
      makeOutline({ mediaGenerations: [{ elementId: 'img-b', type: 'image', prompt: 'B' }] }),
    ];
    await generateMediaForOutlines(outlines, 'stage-multi');
    expect(mockEnqueueTasks).toHaveBeenCalledWith('stage-multi', expect.arrayContaining([
      expect.objectContaining({ elementId: 'img-a' }),
      expect.objectContaining({ elementId: 'img-b' }),
    ]));
  });

  it('marks task failed on API error', async () => {
    mockGetTask.mockReturnValue(null);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Rate limit', errorCode: 'RATE_LIMIT' }),
    } as Response);

    const outlines = [makeOutline()];
    await generateMediaForOutlines(outlines, 'stage-err');
    expect(mockMarkFailed).toHaveBeenCalledWith('gen_img_1', expect.any(String), 'RATE_LIMIT');
  });

  it('respects AbortSignal and stops mid-loop', async () => {
    mockGetTask.mockReturnValue(null);
    const ctrl = new AbortController();
    ctrl.abort();

    const outlines = [makeOutline(), makeOutline({ mediaGenerations: [{ elementId: 'img-2', type: 'image', prompt: 'B' }] })];
    await generateMediaForOutlines(outlines, 'stage-abort', ctrl.signal);
    // No fetch should be attempted after abort
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('retryMediaTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imageGenerationEnabled = true;
  });

  it('does nothing when task does not exist', async () => {
    mockGetTask.mockReturnValue(null);
    await retryMediaTask('nonexistent-id');
    expect(mockMarkFailed).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does nothing when task is not failed', async () => {
    mockGetTask.mockReturnValue({ status: 'done', elementId: 'img-1' });
    await retryMediaTask('img-1');
    expect(mockMarkPendingForRetry).not.toHaveBeenCalled();
  });

  it('marks generation disabled when imageGenerationEnabled is false', async () => {
    imageGenerationEnabled = false;
    mockGetTask.mockReturnValue({
      status: 'failed',
      type: 'image',
      elementId: 'img-1',
      stageId: 'stage-1',
      prompt: 'test',
      params: {},
    });
    await retryMediaTask('img-1');
    expect(mockMarkFailed).toHaveBeenCalledWith('img-1', 'Generation disabled', 'GENERATION_DISABLED');
  });

  it('calls markPendingForRetry on valid image retry', async () => {
    mockGetTask.mockReturnValue({
      status: 'failed',
      type: 'image',
      elementId: 'img-1',
      stageId: 'stage-1',
      prompt: 'Mitochondria diagram',
      params: { aspectRatio: '16:9' },
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, result: { url: 'data:image/png;base64,xyz' } }),
      blob: async () => new Blob([], { type: 'image/png' }),
    } as Response);

    await retryMediaTask('img-1');
    expect(mockMarkPendingForRetry).toHaveBeenCalledWith('img-1');
  });
});
