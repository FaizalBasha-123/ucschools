export type {
  PageType,
  PDFCapability,
  PageMetadata,
  ExtractedPage,
  ImageReference,
  PageSummary,
  PDFParseResult,
  PDFPlugin,
  OCRResult,
} from '@/lib/pdf/plugin';

export interface ParsedPdfContent {
  text: string;
  images: string[];
  metadata?: {
    fileName?: string;
    fileSize?: number;
    pageCount: number;
    parser?: string;
    processingTime?: number;
    imageMapping?: Record<string, string>;
    pdfImages?: Array<{
      id: string;
      src: string;
      pageNumber: number;
      description?: string;
      width?: number;
      height?: number;
    }>;
    [key: string]: unknown;
  };
}

export interface ParsePdfRequest {
  pdf: File;
}

export interface ParsePdfResponse {
  success: boolean;
  data?: ParsedPdfContent;
  error?: string;
}
