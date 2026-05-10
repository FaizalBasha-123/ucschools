export type PDFProviderId = 'pdfjs-local';

export interface PDFProviderConfig {
  id: PDFProviderId;
  name: string;
  pluginId: string;
  isDefault?: boolean;
  features: string[];
}
