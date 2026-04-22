/**
 * PDF Provider Constants
 * Separated from pdf-providers.ts to avoid importing sharp in client components
 */

import type { PDFProviderId, PDFProviderConfig } from './types';

/**
 * PDF Provider Registry
 */
export const PDF_PROVIDERS: Record<PDFProviderId, PDFProviderConfig> = {
  'gemini-openrouter': {
    id: 'gemini-openrouter',
    name: 'Gemini 2.0 Flash (OpenRouter)',
    requiresApiKey: true,
    icon: '/logos/gemini.svg',
    features: ['text', 'images', 'metadata', 'multimodal'],
  },
};

/**
 * Get all available PDF providers
 */
export function getAllPDFProviders(): PDFProviderConfig[] {
  return Object.values(PDF_PROVIDERS);
}

/**
 * Get PDF provider by ID
 */
export function getPDFProvider(providerId: PDFProviderId): PDFProviderConfig | undefined {
  return PDF_PROVIDERS[providerId];
}
