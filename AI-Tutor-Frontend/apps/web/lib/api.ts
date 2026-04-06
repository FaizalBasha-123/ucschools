import type {
  ChatMessage,
  GenerateLessonPayload,
  GenerateLessonResponse,
  Lesson,
  LessonGenerationJob,
  StatelessChatRequest,
  TutorStreamEvent,
} from "@ai-tutor/types";

function apiBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL?.replace(/\/$/, "") ||
    "http://127.0.0.1:8099"
  );
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
  const response = await fetch(`${apiBaseUrl()}/api/runtime/chat/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

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
      const event = parseSseChunk(chunk);
      if (event) {
        onEvent(event);
      }
    }
  }
}

function parseSseChunk(chunk: string): TutorStreamEvent | null {
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

  return JSON.parse(data) as TutorStreamEvent;
}
