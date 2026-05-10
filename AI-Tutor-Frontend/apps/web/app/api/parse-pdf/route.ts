import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { pdfRegistry } from '@/lib/pdf/registry';
import { generatePageSummaries } from '@/lib/pdf/page-summarizer';
import { MAX_PDF_CONTENT_CHARS } from '@/lib/constants/generation';

const log = createLogger('Parse PDF');

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let pdfFileName: string | undefined;
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
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

    const plugin = pdfRegistry.getDefault();
    if (!plugin) {
      return apiError(
        'INTERNAL_ERROR',
        500,
        'No PDF parser plugin available. Ensure pdfjs-dist is installed.',
      );
    }

    const pdfBuffer = await pdfFile.arrayBuffer();

    log.info(
      `Parsing PDF: "${pdfFileName}" (${Math.round(pdfBuffer.byteLength / 1024)}KB) via ${plugin.id}`,
    );

    const result = await plugin.parse(pdfBuffer);

    let fullText = result.fullText;
    if (fullText.length > MAX_PDF_CONTENT_CHARS) {
      fullText = fullText.substring(0, MAX_PDF_CONTENT_CHARS);
    }

    const pageSummaries = generatePageSummaries(result.extractedPages);

    const scannedPages = result.pages
      .filter((p) => p.requiresVisionOcr)
      .map((p) => p.page);

    log.info(
      `PDF parsed: "${pdfFileName}" → ${fullText.length} chars, ` +
        `${result.pages.length} pages, ` +
        `${result.imageReferences.length} images, ` +
        `${scannedPages.length} scanned pages`,
    );

    return apiSuccess({
      data: {
        text: fullText,
        images: [],
        metadata: {
          fileName: pdfFileName,
          fileSize: pdfBuffer.byteLength,
          pageCount: result.pages.length,
          parser: plugin.id,
          processingTime: Date.now(),
          pages: result.pages,
          extractedPages: result.extractedPages,
          imageReferences: result.imageReferences,
          pageSummaries,
          scannedPages,
        },
      },
    });
  } catch (error) {
    log.error(`PDF parsing failed [file="${pdfFileName ?? 'unknown'}"]`, error);
    return apiError('PARSE_FAILED', 500, error instanceof Error ? error.message : 'Unknown error');
  }
}
