import {
  PDFPlugin,
  PDFParseResult,
  PageMetadata,
  PageType,
  ExtractedPage,
  ImageReference,
  PDFCapability,
} from '../plugin';
import { createLogger } from '@/lib/logger';

const log = createLogger('PDFJSPlugin');

let pdfjs: any = null;

async function ensurePdfjs(): Promise<any> {
  if (pdfjs) return pdfjs;
  pdfjs = await import('pdfjs-dist');
  return pdfjs;
}

const IMAGE_OP_MIN = 76;
const IMAGE_OP_MAX = 79;

function classifyPage(
  textItemCount: number,
  imageCount: number,
  hasVectorOps: boolean,
): PageType {
  if (textItemCount === 0 && imageCount === 0 && !hasVectorOps) {
    return PageType.Blank;
  }
  if (textItemCount === 0 && imageCount > 0) {
    if (imageCount >= 3) return PageType.ScannedText;
    return PageType.VectorOnly;
  }
  if (textItemCount > 0 && imageCount > 0) {
    return PageType.Mixed;
  }
  if (textItemCount > 0 && imageCount === 0 && hasVectorOps) {
    return PageType.VectorOnly;
  }
  if (textItemCount > 0) {
    return PageType.Text;
  }
  return PageType.Blank;
}

export class PdfjsPlugin implements PDFPlugin {
  id = 'pdfjs-local';
  name = 'Local PDF.js Parser';
  capabilities: PDFCapability[] = ['classify', 'text-extract', 'image-index', 'page-render'];

  async parse(buffer: ArrayBuffer, signal?: AbortSignal): Promise<PDFParseResult> {
    const pdf = await ensurePdfjs();

    const loadingTask = pdf.getDocument({ data: buffer });
    const doc = await loadingTask.promise;

    if (signal?.aborted) {
      await doc.destroy();
      throw new DOMException('Aborted', 'AbortError');
    }

    const pageCount = doc.numPages;
    const pages: PageMetadata[] = [];
    const extractedPages: ExtractedPage[] = [];
    const imageReferences: ImageReference[] = [];
    const fullTextParts: string[] = [];

    for (let i = 1; i <= pageCount; i++) {
      if (signal?.aborted) {
        await doc.destroy();
        throw new DOMException('Aborted', 'AbortError');
      }

      let page: any;
      try {
        page = await doc.getPage(i);
      } catch (err) {
        log.warn(`Failed to get page ${i}:`, err);
        pages.push({
          page: i,
          pageType: PageType.Blank,
          hasExtractableText: false,
          textLengthChars: 0,
          imageCount: 0,
          estimatedComplexity: 0,
          requiresVisionOcr: false,
        });
        continue;
      }

      let textContent: any;
      let opList: any;
      let textItemCount = 0;
      let imageCount = 0;
      let hasVectorOps = false;

      try {
        textContent = await page.getTextContent();
        textItemCount = textContent.items?.length || 0;
      } catch {
        textItemCount = 0;
      }

      try {
        opList = await page.getOperatorList();
        const fnArray = opList.fnArray;
        const argsArray = opList.argsArray;
        const seenRefs = new Set<string>();

        for (let j = 0; j < fnArray.length; j++) {
          const fn = fnArray[j];
          if (fn >= IMAGE_OP_MIN && fn <= IMAGE_OP_MAX) {
            const args = argsArray[j];
            if (Array.isArray(args) && args.length > 0) {
              const ref = String(args[0]);
              if (!seenRefs.has(ref)) {
                seenRefs.add(ref);
                imageCount++;
              }
            } else {
              imageCount++;
            }
          } else {
            hasVectorOps = true;
          }
        }
      } catch {
        imageCount = 0;
      }

      const pageType = classifyPage(textItemCount, imageCount, hasVectorOps);

      let textLengthChars = 0;
      if (pageType === PageType.Text || pageType === PageType.Mixed) {
        try {
          let text = '';
          for (const item of textContent.items || []) {
            text += item.str || '';
            text += ' ';
          }

          const lastTransform = textContent.items?.[textContent.items.length - 1]?.transform;
          const doesNeedExtraNewline =
            lastTransform &&
            textContent.items?.length > 1 &&
            textContent.items[textContent.items.length - 2]?.transform?.[5] !== lastTransform[5];

          if (doesNeedExtraNewline) {
            text += '\n';
          }

          textLengthChars = text.length;
          if (text.trim().length > 0) {
            extractedPages.push({
              page: i,
              text,
              charCount: text.length,
            });
            fullTextParts.push(text);
          }
        } catch {
          textLengthChars = 0;
        }
      }

      if (imageCount > 0) {
        for (let imgIdx = 0; imgIdx < imageCount; imgIdx++) {
          imageReferences.push({
            page: i,
            imageId: `img_p${i}_${imgIdx + 1}`,
            width: 0,
            height: 0,
          });
        }
      }

      const isScannedAndLowOcr =
        pageType === PageType.ScannedText || (pageType === PageType.VectorOnly && textItemCount === 0);

      pages.push({
        page: i,
        pageType,
        hasExtractableText: textItemCount > 0,
        textLengthChars,
        imageCount,
        estimatedComplexity: Math.min(10, imageCount * 2 + (textItemCount > 0 ? 1 : 0)),
        requiresVisionOcr: isScannedAndLowOcr,
      });

      try {
        page.cleanup();
      } catch {
        // ignore cleanup errors
      }
    }

    const fullText = fullTextParts.join('\n\n');

    try {
      await doc.destroy();
    } catch {
      // ignore destroy errors
    }

    return {
      pages,
      extractedPages,
      imageReferences,
      pageSummaries: [],
      fullText,
    };
  }

  async renderPage(buffer: ArrayBuffer, pageNum: number): Promise<Uint8Array> {
    const pdf = await ensurePdfjs();
    const loadingTask = pdf.getDocument({ data: buffer });
    const doc = await loadingTask.promise;
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 });

    let canvas: any;
    let context: any;
    try {
      // @ts-expect-error - canvas is optional; failure is caught and handled below
      const { createCanvas } = await import('canvas');
      canvas = createCanvas(viewport.width, viewport.height);
      context = canvas.getContext('2d');
    } catch {
      await doc.destroy();
      throw new Error(
        'Page rendering requires the "canvas" package. ' +
          'Install it with: npm install canvas. ' +
          'For OCR, render the page on the client instead.',
      );
    }

    await page.render({ canvasContext: context, viewport }).promise;
    const pngBuffer = canvas.toBuffer('image/png');

    try {
      page.cleanup();
      await doc.destroy();
    } catch {}

    return new Uint8Array(pngBuffer);
  }
}
