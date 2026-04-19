import { authHeaders } from '@/lib/auth/session';

export type LessonShelfStatus = 'generating' | 'ready' | 'failed' | 'archived';

export interface LessonShelfItem {
  id: string;
  lesson_id: string;
  source_job_id?: string | null;
  title: string;
  subject?: string | null;
  language?: string | null;
  status: LessonShelfStatus;
  progress_pct: number;
  last_opened_at?: string | null;
  archived_at?: string | null;
  thumbnail_url?: string | null;
  failure_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LessonShelfListResponse {
  success: true;
  items: LessonShelfItem[];
}

export interface LessonShelfItemResponse {
  success: true;
  id: string;
  lesson_id: string;
  source_job_id?: string | null;
  title: string;
  subject?: string | null;
  language?: string | null;
  status: LessonShelfStatus;
  progress_pct: number;
  last_opened_at?: string | null;
  archived_at?: string | null;
  thumbnail_url?: string | null;
  failure_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LessonShelfMutationResponse {
  success: false;
  error: string;
  details?: string;
}

function baseUrl(): string {
  return '';
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function fetchShelf(status?: LessonShelfStatus) {
  const url = new URL(`${baseUrl()}/api/lesson-shelf`, window.location.origin);
  if (status) {
    url.searchParams.set('status', status);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: authHeaders(),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as LessonShelfMutationResponse | null;
    throw new Error(error?.error || 'Failed to load lesson shelf');
  }

  return parseJson<LessonShelfListResponse>(response);
}

export async function renameShelfItem(itemId: string, title: string) {
  const response = await fetch(`${baseUrl()}/api/lesson-shelf/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    headers: authHeaders({
      'Content-Type': 'application/json',
    }),
    credentials: 'include',
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as LessonShelfMutationResponse | null;
    throw new Error(error?.error || 'Failed to rename lesson');
  }

  return parseJson<LessonShelfItemResponse>(response);
}

export async function archiveShelfItem(itemId: string) {
  const response = await fetch(`${baseUrl()}/api/lesson-shelf/${encodeURIComponent(itemId)}/archive`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as LessonShelfMutationResponse | null;
    throw new Error(error?.error || 'Failed to archive lesson');
  }

  return parseJson<LessonShelfItemResponse>(response);
}

export async function reopenShelfItem(itemId: string) {
  const response = await fetch(`${baseUrl()}/api/lesson-shelf/${encodeURIComponent(itemId)}/reopen`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as LessonShelfMutationResponse | null;
    throw new Error(error?.error || 'Failed to reopen lesson');
  }

  return parseJson<LessonShelfItemResponse>(response);
}

export async function retryShelfItem(itemId: string) {
  const response = await fetch(`${baseUrl()}/api/lesson-shelf/${encodeURIComponent(itemId)}/retry`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as LessonShelfMutationResponse | null;
    throw new Error(error?.error || 'Failed to retry lesson');
  }

  return parseJson<LessonShelfItemResponse>(response);
}

export async function markShelfOpened(lessonId: string, itemId?: string) {
  const response = await fetch(`${baseUrl()}/api/lesson-shelf/mark-opened`, {
    method: 'POST',
    headers: authHeaders({
      'Content-Type': 'application/json',
    }),
    credentials: 'include',
    body: JSON.stringify({ lesson_id: lessonId, item_id: itemId }),
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as LessonShelfMutationResponse | null;
    throw new Error(error?.error || 'Failed to mark lesson opened');
  }

  return parseJson<LessonShelfItemResponse>(response);
}
