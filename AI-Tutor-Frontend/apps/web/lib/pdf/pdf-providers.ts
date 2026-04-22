/**
 * PDF Parsing Provider Implementation
 *
 * This implementation replaces unpdf and MinerU with Gemini 2.0 Flash via OpenRouter.
 */

import type { PDFParserConfig } from './types';
import type { ParsedPdfContent } from '@/lib/types/pdf';
import { PDF_PROVIDERS } from './constants';
import { createLogger } from '@/lib/logger';

const log = createLogger('PDFProviders');

/**
 * Parse PDF using specified provider
 */
export async function parsePDF(
  config: PDFParserConfig,
  pdfBuffer: Buffer,
): Promise<ParsedPdfContent> {
  const provider = PDF_PROVIDERS[config.providerId];
  if (!provider) {
    throw new Error(`Unknown PDF provider: ${config.providerId}`);
  }

  // Validate API key if required
  if (provider.requiresApiKey && !config.apiKey) {
    // Fallback to env var if not provided in config
    config.apiKey = process.env.PDF_OPENROUTER_API_KEY;
    if (!config.apiKey) {
      throw new Error(`API key required for PDF provider: ${config.providerId}. Please set PDF_OPENROUTER_API_KEY.`);
    }
  }

  const startTime = Date.now();

  let result: ParsedPdfContent;

  switch (config.providerId) {
    case 'gemini-openrouter':
      result = await parseWithGeminiOpenRouter(config, pdfBuffer);
      break;

    default:
      throw new Error(`Unsupported PDF provider: ${config.providerId}`);
  }

  // Add processing time to metadata
  if (result.metadata) {
    result.metadata.processingTime = Date.now() - startTime;
  }

  return result;
}

/**
 * Parse PDF using Gemini 2.0 Flash via OpenRouter
 */
async function parseWithGeminiOpenRouter(
  config: PDFParserConfig,
  pdfBuffer: Buffer,
): Promise<ParsedPdfContent> {
  const apiKey = config.apiKey || process.env.PDF_OPENROUTER_API_KEY;
  const baseUrl = config.baseUrl || process.env.PDF_OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  const model = process.env.PDF_OPENROUTER_MODEL || 'google/gemini-2.0-flash-001';

  if (!apiKey) {
    throw new Error('OpenRouter API key is required for Gemini PDF parsing.');
  }

  log.info(`[GeminiOpenRouter] Parsing PDF with model ${model} via ${baseUrl}`);

  const base64Pdf = pdfBuffer.toString('base64');

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Please parse this PDF and return its full content in Markdown format. ' +
                      'Preserve the structure, including headings, tables, and lists. ' +
                      'If there are images, describe them in place using ALT text style within the Markdown.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:application/pdf;base64,${base64Pdf}`
                }
              }
            ]
          }
        ],
        temperature: 0.1,
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`OpenRouter API error (${response.status}): ${JSON.stringify(errorData)}`);
    }

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content || '';

    return {
      text: content,
      images: [], // Gemini describes images in text in this mode
      metadata: {
        pageCount: 0, // Gemini doesn't explicitly return this in a standard chat completion
        parser: 'gemini-openrouter',
        model: model,
      },
    };
  } catch (error) {
    log.error('[GeminiOpenRouter] PDF parsing failed:', error);
    throw error;
  }
}

/**
 * Get current PDF parser configuration from settings store
 * Note: This function should only be called in browser context
 */
export async function getCurrentPDFConfig(): Promise<PDFParserConfig> {
  if (typeof window === 'undefined') {
    throw new Error('getCurrentPDFConfig() can only be called in browser context');
  }

  // Dynamic import to avoid circular dependency
  const { useSettingsStore } = await import('@/lib/store/settings');
  const { pdfProviderId, pdfProvidersConfig } = useSettingsStore.getState();

  // If the stored provider is no longer valid, fallback to gemini-openrouter
  const actualProviderId = (pdfProviderId === 'gemini-openrouter') 
    ? 'gemini-openrouter' 
    : 'gemini-openrouter';

  const providerConfig = pdfProvidersConfig?.[actualProviderId];

  return {
    providerId: actualProviderId as any,
    apiKey: providerConfig?.apiKey,
    baseUrl: providerConfig?.baseUrl,
  };
}

// Re-export from constants for convenience
export { getAllPDFProviders, getPDFProvider } from './constants';
