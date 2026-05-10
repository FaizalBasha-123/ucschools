import { PDFPlugin, PDFCapability } from './plugin';

export class PDFPluginRegistry {
  private plugins = new Map<string, PDFPlugin>();

  register(plugin: PDFPlugin): void {
    if (this.plugins.has(plugin.id)) {
      return;
    }
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): PDFPlugin | undefined {
    return this.plugins.get(id);
  }

  getAll(): PDFPlugin[] {
    return Array.from(this.plugins.values());
  }

  getDefault(): PDFPlugin | undefined {
    return this.plugins.get('pdfjs-local');
  }

  getWithCapability(cap: PDFCapability): PDFPlugin[] {
    return this.getAll().filter((p) => p.capabilities.includes(cap));
  }

  has(id: string): boolean {
    return this.plugins.has(id);
  }
}

export const pdfRegistry = new PDFPluginRegistry();
