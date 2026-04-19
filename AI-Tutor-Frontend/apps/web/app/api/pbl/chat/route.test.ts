import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from './route';

describe('PBL chat proxy route', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.AI_TUTOR_API_BASE_URL = 'http://backend.internal';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.AI_TUTOR_API_BASE_URL;
  });

  it('forwards request to backend runtime chat and returns payload', async () => {
    const backendPayload = {
      messages: [{ kind: 'agent', agent_name: 'Question Agent', message: 'Try step one.' }],
      workspace: {
        active_issue_id: 'issue-1',
        issues: [],
      },
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(backendPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    const req = new NextRequest('http://localhost:3000/api/pbl/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-key',
        authorization: 'Bearer test-session-token',
        cookie: 'ai_tutor_session=test-cookie-token',
      },
      body: JSON.stringify({ message: 'hello', project_config: {}, workspace: {} }),
    });

    const response = await POST(req);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual(backendPayload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://backend.internal/api/runtime/pbl/chat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-api-key': 'test-key',
          authorization: 'Bearer test-session-token',
          cookie: 'ai_tutor_session=test-cookie-token',
        }),
      }),
    );
  });

  it('maps backend non-200 response into standardized API error', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('upstream failed', {
        status: 502,
        headers: { 'Content-Type': 'text/plain' },
      }),
    ) as typeof fetch;

    const req = new NextRequest('http://localhost:3000/api/pbl/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });

    const response = await POST(req);
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json).toMatchObject({
      success: false,
      errorCode: 'INTERNAL_ERROR',
      error: 'Backend PBL chat failed',
      details: 'upstream failed',
    });
  });

  it('falls back to default local backend URL when env is absent', async () => {
    delete process.env.AI_TUTOR_API_BASE_URL;
    delete process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL;

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    const req = new NextRequest('http://localhost:3000/api/pbl/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });

    await POST(req);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8099/api/runtime/pbl/chat',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
