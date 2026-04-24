# PDF Parsing Implementation

This module handles PDF document parsing to extract text and images for course generation.

## Implementation Details

The current implementation uses **Gemini 2.0 Flash via OpenRouter** as the primary PDF parsing engine. This provides a robust, multimodal approach to document analysis without requiring local service deployment.

### Features
- **Text Extraction**: High-quality text extraction including structure and layout awareness.
- **Multimodal Analysis**: Leverages Gemini's vision capabilities to understand document context.
- **Metadata Extraction**: Automatic detection of page counts and other document properties.

## Configuration

The PDF parser is configured via environment variables or client-side settings.

### Environment Variables (Server-side)
- `PDF_OPENROUTER_API_KEY`: Your OpenRouter API Key.
- `PDF_OPENROUTER_BASE_URL`: (Optional) Custom OpenRouter API endpoint.
- `PDF_OPENROUTER_MODEL`: (Optional) Defaults to `google/gemini-2.0-flash-001`.

## Provider Integration

The system is designed to be extensible. Currently, it supports:

1. **Gemini 2.0 Flash (OpenRouter)**
   - Recommended for production.
   - Supports text and multimodal features.
   - Requires an API Key.

## Data Structures

### `ParsedPdfContent`
```typescript
export interface ParsedPdfContent {
  text: string;
  images: string[];
  metadata?: {
    pageCount: number;
    parser: string;
    [key: string]: unknown;
  };
}
```
