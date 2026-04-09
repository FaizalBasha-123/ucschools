import type {
  ChatMessage,
  GenerateLessonPayload,
  GenerateLessonResponse,
  Lesson,
  LessonGenerationJob,
  PlaybackEvent,
  StatelessChatRequest,
  TutorStreamEvent,
} from "@ai-tutor/types";

function apiBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL?.replace(/\/$/, "");
  if (configured) {
    return configured;
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  }
  return "http://127.0.0.1:8099";
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function generateLesson(
  payload: GenerateLessonPayload,
): Promise<GenerateLessonResponse> {
  const response = await fetch(`${apiBaseUrl()}/api/lessons/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return parseJson<GenerateLessonResponse>(response);
}

export async function getLesson(id: string): Promise<Lesson> {
  const response = await fetch(`${apiBaseUrl()}/api/lessons/${id}`, {
    cache: "no-store",
  });

  return parseJson<Lesson>(response);
}

export async function getJob(id: string): Promise<LessonGenerationJob> {
  const response = await fetch(`${apiBaseUrl()}/api/lessons/jobs/${id}`, {
    cache: "no-store",
  });

  return parseJson<LessonGenerationJob>(response);
}

export async function streamTutorChat(
  payload: StatelessChatRequest,
  onEvent: (event: TutorStreamEvent) => void,
): Promise<void> {
  return streamSse(`${apiBaseUrl()}/api/runtime/chat/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  }, onEvent);
}

export async function streamLessonPlayback(
  lessonId: string,
  onEvent: (event: PlaybackEvent) => void,
): Promise<void> {
  return streamSse(`${apiBaseUrl()}/api/lessons/${lessonId}/events`, {
    method: "GET",
  }, onEvent);
}

export async function acknowledgeRuntimeAction(payload: {
  session_id: string;
  runtime_session_id?: string | null;
  runtime_session_mode?: string | null;
  execution_id: string;
  action_name?: string | null;
  status: "accepted" | "completed" | "failed" | "timed_out";
  error?: string | null;
}): Promise<{ accepted: boolean }> {
  const response = await fetch(`${apiBaseUrl()}/api/runtime/actions/ack`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return parseJson<{ accepted: boolean }>(response);
}

async function streamSse<T>(
  url: string,
  init: RequestInit,
  onEvent: (event: T) => void,
): Promise<void> {
  const response = await fetch(url, init);

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const event = parseSseChunk<T>(chunk);
      if (event) {
        onEvent(event);
      }
    }
  }
}

function parseSseChunk<T>(chunk: string): T | null {
  const lines = chunk.split("\n");
  let data = "";

  for (const line of lines) {
    if (line.startsWith("data:")) {
      data += line.slice(5).trim();
    }
  }

  if (!data) {
    return null;
  }

  return JSON.parse(data) as T;
}
