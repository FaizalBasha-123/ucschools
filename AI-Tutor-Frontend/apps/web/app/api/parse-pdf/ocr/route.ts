import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { tesseractOCR } from '@/lib/pdf/plugins/tesseract-ocr';
import { OCR_CONFIDENCE_THRESHOLD } from '@/lib/constants/generation';

const log = createLogger('PDF OCR');

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pageNumber, imageBase64 } = body as {
      pageNumber: number;
      imageBase64: string;
    };

    if (!pageNumber || !imageBase64) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'Both pageNumber and imageBase64 are required',
      );
    }

    const imageBuffer = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));

    log.info(`Running OCR on page ${pageNumber} (${imageBuffer.byteLength} bytes)`);

    const result = await tesseractOCR.ocrPage(imageBuffer);

    const requiresVisionEscalation = result.confidence < OCR_CONFIDENCE_THRESHOLD;

    log.info(
      `OCR page ${pageNumber}: ${result.text.length} chars, ` +
        `confidence=${result.confidence}, ` +
        `escalate=${requiresVisionEscalation}`,
    );

    return apiSuccess({
      data: {
        pageNumber,
        text: result.text,
        confidence: result.confidence,
        requiresVisionEscalation,
      },
    });
  } catch (error) {
    log.error('OCR failed:', error);
    return apiError('OCR_FAILED', 500, error instanceof Error ? error.message : 'Unknown error');
  }
}
