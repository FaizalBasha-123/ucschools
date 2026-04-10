import { promises as fs, createReadStream } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { CLASSROOMS_DIR, isValidClassroomId } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('ClassroomMedia');

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ classroomId: string; path: string[] }> },
) {
  const { classroomId, path: pathSegments } = await params;

  if (pathSegments.length < 2) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const subDir = pathSegments[0];
  if (subDir !== 'media' && subDir !== 'audio') {
    return NextResponse.json({ error: 'Invalid path' }, { status: 404 });
  }

  const fileName = pathSegments.slice(1).join('/');
  const backendUrl = process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL || process.env.AI_TUTOR_API_BASE_URL || 'http://127.0.0.1:8099';

  try {
    const backendRes = await fetch(`${backendUrl}/api/assets/${subDir}/${classroomId}/${fileName}`, {
      method: 'GET',
    });

    if (backendRes.status === 404) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      log.error(`Backend media retrieval failed: [${backendRes.status}] ${errorText}`);
      return NextResponse.json({ error: 'Internal error' }, { status: backendRes.status });
    }

    const headers = new Headers(backendRes.headers);
    headers.set('Cache-Control', 'public, max-age=86400, immutable');

    return new NextResponse(backendRes.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    log.error(
      `Classroom media serving failed [classroomId=${classroomId}, path=${pathSegments.join('/')}]:`,
      error,
    );
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

