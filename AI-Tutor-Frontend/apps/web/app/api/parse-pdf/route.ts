import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError } from '@/lib/server/api-response';

const log = createLogger('Parse PDF');

export async function POST(req: NextRequest) {
  let pdfFileName: string | undefined;
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      log.error('Invalid Content-Type for PDF upload:', contentType);
      return apiError(
        'INVALID_REQUEST',
        400,
        `Invalid Content-Type: expected multipart/form-data, got "${contentType}"`,
      );
    }

    const formData = await req.formData();
    const pdfFile = formData.get('pdf') as File | null;

    if (!pdfFile) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'No PDF file provided');
    }

    pdfFileName = pdfFile.name;

    const backendUrl =
      process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL ||
      process.env.AI_TUTOR_API_BASE_URL ||
      'http://127.0.0.1:8099';

    const backendFormData = new FormData();
    backendFormData.append('pdf', pdfFile);

    // Proxy the request to the Rust backend
    const backendRes = await fetch(`${backendUrl}/api/tools/parse-pdf`, {
      method: 'POST',
      body: backendFormData,
    });

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      log.error(`Backend PDF parsing failed: ${backendRes.status} ${errorText}`);
      return apiError('UPSTREAM_ERROR', backendRes.status, 'Backend PDF parsing failed', errorText);
    }

    const json = await backendRes.json();
    return NextResponse.json(json);
  } catch (error) {
    log.error(`PDF parsing failed [file="${pdfFileName ?? 'unknown'}"]:`, error);
    return apiError('PARSE_FAILED', 500, error instanceof Error ? error.message : 'Unknown error');
  }
}
