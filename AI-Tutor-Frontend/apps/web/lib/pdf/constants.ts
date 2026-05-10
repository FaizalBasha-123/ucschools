import type { PDFProviderConfig, PDFProviderId } from './types';
import { pdfRegistry } from './registry';
import { PdfjsPlugin } from './plugins/pdfjs-plugin';

function initializePlugins(): void {
  if (!pdfRegistry.has('pdfjs-local')) {
    pdfRegistry.register(new PdfjsPlugin());
  }
}

initializePlugins();

export const PDF_PROVIDERS: Record<PDFProviderId, PDFProviderConfig> = {
  'pdfjs-local': {
    id: 'pdfjs-local',
    name: 'Local PDF.js Parser',
    pluginId: 'pdfjs-local',
    isDefault: true,
    features: ['text', 'images', 'metadata', 'page-rendering'],
  },
};

export function getAllPDFProviders(): PDFProviderConfig[] {
  return Object.values(PDF_PROVIDERS);
}

export function getPDFProvider(id: string): PDFProviderConfig | undefined {
  return PDF_PROVIDERS[id as PDFProviderId];
}

export const DEFAULT_PDF_PROVIDER = 'pdfjs-local';
