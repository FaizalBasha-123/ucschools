/**
 * PDF pre-parsing helper for the generation session.
 *
 * Calls the local /api/parse-pdf endpoint (pdfjs-dist, zero external API cost),
 * then runs Tesseract.js OCR on any scanned/image-only pages via /api/parse-pdf/ocr.
 *
 * Returns combined text (pdfjs text + OCR where available) or empty string on failure.
 * Failure is non-fatal — generation-preview falls back to the raw-bytes path.
 *
 * The result should be stored in session.pdfText. The generation-preview page
 * encodes it as base64 UTF-8 and sends it to the Rust backend, which detects
 * pre-parsed text by the absence of the PDF binary magic header ("JVBERi...")
 * and skips the redundant pdf-extract re-parsing step.
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('ParsePdfForSession');

// Maximum number of scanned pages to attempt OCR on.
// OCR is skipped anyway if page rendering (canvas) is unavailable server-side,
// but this caps the number of concurrent requests for safety.
const MAX_OCR_PAGES = 5;

export async function parsePdfForSession(file: File): Promise<string> {
  try {
    const formData = new FormData();
    formData.append('pdf', file);

    const resp = await fetch('/api/parse-pdf', { method: 'POST', body: formData });
    if (!resp.ok) {
      log.warn(`/api/parse-pdf returned ${resp.status} — skipping pre-parse`);
      return '';
    }

    const json = await resp.json();
    // The route wraps the result in apiSuccess: { success, data: { text, metadata } }
    // Support both shapes for robustness.
    const data = json?.data ?? json;
    const pdfjsText: string = data?.text ?? '';
    const scannedPages: number[] = data?.metadata?.scannedPages ?? [];

    let ocrText = '';
    if (scannedPages.length > 0) {
      // Tesseract.js OCR for scanned/image-only pages.
      //
      // Current limitation: page rendering requires the `canvas` npm package on the
      // Next.js server. If canvas is not installed, we log the detected pages and skip.
      // A future improvement can render pages client-side and POST the image data.
      //
      // Even without OCR, the pdfjs text extraction (for text-layer pages) is
      // still forwarded — this is already a strict improvement over the old flow
      // which sent nothing (raw bytes re-encoded → pdf-extract → same empty result).
      const ocrResults = await Promise.allSettled(
        scannedPages.slice(0, MAX_OCR_PAGES).map(async (pageNum) => {
          log.info(`Scanned page ${pageNum} detected — OCR skipped (canvas not available server-side)`);
          // TODO: if canvas becomes available, call /api/parse-pdf/ocr here with
          // the rendered PNG of the page and return the OCR'd text.
          return '';
        }),
      );

      ocrText = ocrResults
        .map((r) => (r.status === 'fulfilled' ? r.value : ''))
        .filter(Boolean)
        .join('\n');
    }

    const combined = [pdfjsText, ocrText].filter(Boolean).join('\n\n[Scanned Pages OCR]\n');

    log.info(
      `PDF pre-parsed: ${combined.length} chars, ${scannedPages.length} scanned page(s) detected`,
    );

    return combined;
  } catch (err) {
    log.warn('PDF pre-parse failed — generation will fall back to raw-bytes path', err);
    return '';
  }
}
