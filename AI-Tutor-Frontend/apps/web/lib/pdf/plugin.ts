export enum PageType {
  Text = 'text',
  ScannedText = 'scanned',
  Mixed = 'mixed',
  VectorOnly = 'vector',
  Blank = 'blank',
}

export type PDFCapability =
  | 'classify'
  | 'text-extract'
  | 'image-index'
  | 'page-render'
  | 'ocr';

export interface PageMetadata {
  page: number;
  pageType: PageType;
  hasExtractableText: boolean;
  textLengthChars: number;
  imageCount: number;
  estimatedComplexity: number;
  requiresVisionOcr: boolean;
}

export interface ExtractedPage {
  page: number;
  text: string;
  charCount: number;
}

export interface ImageReference {
  page: number;
  imageId: string;
  width: number;
  height: number;
  colorSpace?: string;
  position?: { x: number; y: number; w: number; h: number };
}

export interface PageSummary {
  page: number;
  keywords: string[];
  shortSummary: string;
  sectionHeading?: string;
}

export interface PDFParseResult {
  pages: PageMetadata[];
  extractedPages: ExtractedPage[];
  imageReferences: ImageReference[];
  pageSummaries: PageSummary[];
  fullText: string;
}

export interface PDFPlugin {
  id: string;
  name: string;
  capabilities: PDFCapability[];

  parse(buffer: ArrayBuffer, signal?: AbortSignal): Promise<PDFParseResult>;
}

export interface OCRResult {
  text: string;
  confidence: number;
}

export interface PDFPluginConstructor {
  new(): PDFPlugin;
}

export interface OCRPageRequest {
  pageNumber: number;
  imageBuffer: Uint8Array;
  contentType: string;
}

export interface OCRPageResponse {
  pageNumber: number;
  text: string;
  confidence: number;
  requiresVisionEscalation: boolean;
}
