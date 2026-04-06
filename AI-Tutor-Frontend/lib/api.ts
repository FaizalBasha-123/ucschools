// ---------------------------------------------------------------------------
// AI-Tutor Backend API Client
// ---------------------------------------------------------------------------

function apiBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL?.replace(/\/$/, '') ||
    'http://127.0.0.1:8099'
  );
}

function authHeaders(): Record<string, string> {
  const token = process.env.NEXT_PUBLIC_AI_TUTOR_API_TOKEN;
  if (token) {
    return { authorization: `Bearer ${token}` };
  }
  return {};
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Types (inline — no external package dependency)
// ---------------------------------------------------------------------------

export interface GenerateLessonPayload {
  requirement: string;
  language: string;
  enable_web_search?: boolean;
  enable_image_generation?: boolean;
  enable_video_generation?: boolean;
  enable_tts?: boolean;
  agent_mode?: string;
  pdf_text?: string;
}

export interface GenerateLessonResponse {
  lesson_id: string;
  job_id: string;
  url: string;
  scenes_count: number;
}

export interface LessonGenerationJob {
  id: string;
  status: string;
  step: string;
  progress: number;
  message: string;
  lesson_id?: string;
}

export interface SlideElement {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string;
  font_size?: number;
  font_color?: string;
  font_weight?: string;
  font_style?: string;
  text_align?: string;
  background_color?: string;
  border_radius?: number;
  src?: string;
  alt?: string;
  stroke_color?: string;
  stroke_width?: number;
  shape_type?: string;
  rotation?: number;
  opacity?: number;
}

export interface SlideCanvas {
  id: string;
  viewport_width: number;
  viewport_height: number;
  background_color: string;
  elements: SlideElement[];
}

export interface QuizOption {
  label: string;
  value: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  question_type: string;
  options: QuizOption[];
  answer: string;
  has_answer?: boolean;
  points?: number;
}

export interface SceneContent {
  type: string;
  canvas?: SlideCanvas;
  questions?: QuizQuestion[];
  url?: string;
  html?: string;
  project_config?: { summary: string };
}

export interface LessonAction {
  id: string;
  type: string;
  text?: string;
  audio_url?: string;
  voice?: string;
  speed?: number;
  topic?: string;
  prompt?: string;
  element_id?: string;
  content?: string;
  [key: string]: unknown;
}

export interface Scene {
  id: string;
  stage_id: string;
  title: string;
  order: number;
  content: SceneContent;
  actions: LessonAction[];
}

export interface Lesson {
  id: string;
  title: string;
  language: string;
  description?: string;
  scenes: Scene[];
  style?: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StatelessChatRequest {
  lesson_id: string;
  action_id: string;
  messages: ChatMessage[];
  lesson_phase?: string;
  scene_context?: string;
  topic?: string;
}

export interface TutorStreamEvent {
  kind: string;
  session_id: string;
  agent_id?: string;
  agent_name?: string;
  content?: string;
  message?: string;
}

export interface PlaybackEvent {
  lesson_id: string;
  kind: string;
  scene_id?: string;
  scene_title?: string;
  scene_index?: number;
  action_id?: string;
  action_type?: string;
  action_index?: number;
  summary: string;
}

export interface QuizGradePayload {
  lesson_id: string;
  scene_id: string;
  answers: { question_index: number; selected: string }[];
}

export interface QuizGradeResponse {
  total: number;
  correct: number;
  score_percent: number;
  results: {
    question_index: number;
    selected: string;
    correct_answer: string;
    is_correct: boolean;
  }[];
}

export interface TranscribeResponse {
  text: string;
}

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

export async function generateLesson(
  payload: GenerateLessonPayload,
): Promise<GenerateLessonResponse> {
  const response = await fetch(`${apiBaseUrl()}/api/lessons/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return parseJson<GenerateLessonResponse>(response);
}

export async function generateLessonAsync(
  payload: GenerateLessonPayload,
): Promise<GenerateLessonResponse> {
  const response = await fetch(`${apiBaseUrl()}/api/lessons/generate-async`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return parseJson<GenerateLessonResponse>(response);
}

export async function getLesson(id: string): Promise<Lesson> {
  const response = await fetch(`${apiBaseUrl()}/api/lessons/${id}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  return parseJson<Lesson>(response);
}

export async function getJob(id: string): Promise<LessonGenerationJob> {
  const response = await fetch(`${apiBaseUrl()}/api/lessons/jobs/${id}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  return parseJson<LessonGenerationJob>(response);
}

export async function gradeQuiz(
  payload: QuizGradePayload,
): Promise<QuizGradeResponse> {
  const response = await fetch(`${apiBaseUrl()}/api/lessons/grade`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return parseJson<QuizGradeResponse>(response);
}

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.webm');
  const response = await fetch(`${apiBaseUrl()}/api/transcribe`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  const result = await parseJson<TranscribeResponse>(response);
  return result.text;
}

export async function streamTutorChat(
  payload: StatelessChatRequest,
  onEvent: (event: TutorStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/api/runtime/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
    signal,
  });
  await streamSseResponse(response, onEvent);
}

export async function streamLessonPlayback(
  lessonId: string,
  onEvent: (event: PlaybackEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `${apiBaseUrl()}/api/lessons/${lessonId}/events`,
    { cache: 'no-store', signal, headers: authHeaders() },
  );
  await streamSseResponse(response, onEvent);
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

async function streamSseResponse<T>(
  response: Response,
  onEvent: (event: T) => void,
): Promise<void> {
  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      const event = parseSseChunk<T>(chunk);
      if (event) onEvent(event);
    }
  }
}

function parseSseChunk<T>(chunk: string): T | null {
  const lines = chunk.split('\n');
  let data = '';
  for (const line of lines) {
    if (line.startsWith('data:')) {
      data += line.slice(5).trim();
    }
  }
  if (!data) return null;
  return JSON.parse(data) as T;
}
