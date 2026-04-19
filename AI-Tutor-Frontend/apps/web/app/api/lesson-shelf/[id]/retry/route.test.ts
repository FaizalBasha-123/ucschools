import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from './route';

describe('Lesson shelf retry proxy route', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.AI_TUTOR_API_BASE_URL = 'http://backend.internal';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.AI_TUTOR_API_BASE_URL;
  });

  it('forwards retry to backend and returns success payload', async () => {
    const backendPayload = {
      id: 'shelf-1',
      lesson_id: 'lesson-1',
      status: 'generating',
      progress_pct: 0,
      title: 'Retrying lesson',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(backendPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    const req = new NextRequest('http://localhost:3000/api/lesson-shelf/shelf-1/retry', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        cookie: 'session=abc',
      },
    });

    const response = await POST(req, {
      params: Promise.resolve({ id: 'shelf-1' }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ success: true });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://backend.internal/api/lesson-shelf/shelf-1/retry',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer token',
          cookie: 'session=abc',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('maps backend non-200 response into standardized API error', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('snapshot missing', {
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
      }),
    ) as typeof fetch;

    const req = new NextRequest('http://localhost:3000/api/lesson-shelf/shelf-1/retry', {
      method: 'POST',
    });

    const response = await POST(req, {
      params: Promise.resolve({ id: 'shelf-1' }),
    });
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json).toMatchObject({
      success: false,
      errorCode: 'INTERNAL_ERROR',
      error: 'Failed to retry lesson shelf item',
      details: 'snapshot missing',
    });
  });

  it('falls back to local backend URL when env config is absent', async () => {
    delete process.env.AI_TUTOR_API_BASE_URL;
    delete process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL;

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    const req = new NextRequest('http://localhost:3000/api/lesson-shelf/shelf-1/retry', {
      method: 'POST',
    });

    await POST(req, {
      params: Promise.resolve({ id: 'shelf-1' }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8099/api/lesson-shelf/shelf-1/retry',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});