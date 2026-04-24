/**
 * PDF parsing result types
 * Simplified to support standard text and image extraction
 */

/**
 * Parsed PDF content with text and images
 */
export interface ParsedPdfContent {
  /** Extracted text content from the PDF */
  text: string;

  /** Array of images as base64 data URLs */
  images: string[];

  /** Metadata about the PDF */
  metadata?: {
    fileName?: string;
    fileSize?: number;
    pageCount: number;
    parser?: string; // e.g., 'gemini-openrouter'
    processingTime?: number;
    /** Image ID to base64 URL mapping (used in generation pipeline) */
    imageMapping?: Record<string, string>; // e.g., { "img_1": "data:image/png;base64,..." }
    /** PdfImage array with page numbers (used in generation pipeline) */
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

/**
 * Request parameters for PDF parsing
 */
export interface ParsePdfRequest {
  /** PDF file to parse */
  pdf: File;
}

/**
 * Response from PDF parsing API
 */
export interface ParsePdfResponse {
  success: boolean;
  data?: ParsedPdfContent;
  error?: string;
}
