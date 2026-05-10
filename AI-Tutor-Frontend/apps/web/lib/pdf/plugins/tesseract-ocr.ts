import { PDFPlugin, PDFParseResult, OCRResult } from '../plugin';
import { OCR_CONFIDENCE_THRESHOLD } from '@/lib/constants/generation';
import { createLogger } from '@/lib/logger';

const log = createLogger('TesseractOCR');

let Tesseract: any = null;

async function ensureTesseract(): Promise<any> {
  if (Tesseract) return Tesseract;
  try {
    Tesseract = await import('tesseract.js');
    return Tesseract;
  } catch (e) {
    throw new Error('Failed to load tesseract.js. Ensure the dependency is installed.');
  }
}

export class TesseractOCRPlugin implements PDFPlugin {
  id = 'tesseract-ocr';
  name = 'Tesseract OCR (English)';
  capabilities = ['ocr'] as any;

  async parse(_buffer: ArrayBuffer, _signal?: AbortSignal): Promise<PDFParseResult> {
    throw new Error(
      'TesseractOCRPlugin is not a standalone parser. ' +
        'Use it via ocrPage() after rendering a page with pdfjs-local.',
    );
  }

  async ocrPage(imageBuffer: Uint8Array): Promise<OCRResult> {
    const tesseract = await ensureTesseract();

    log.info('Running OCR on page image', { size: imageBuffer.byteLength });

    const result = await tesseract.recognize(imageBuffer, 'eng', {
      // logger: (m: any) => {
      //   if (m.status === 'recognizing text') {
      //     log.debug(`OCR progress: ${Math.round((m.progress || 0) * 100)}%`);
      //   }
      // },
    });

    const text = result.data.text || '';
    const confidence = result.data.confidence || 0;

    log.info(`OCR complete: ${text.length} chars, confidence=${confidence}`);

    return { text, confidence };
  }

  shouldEscalateToVision(result: OCRResult): boolean {
    return result.confidence < OCR_CONFIDENCE_THRESHOLD;
  }
}

export const tesseractOCR = new TesseractOCRPlugin();
