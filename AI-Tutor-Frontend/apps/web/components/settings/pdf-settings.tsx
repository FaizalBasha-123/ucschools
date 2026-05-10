'use client';

import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { PDF_PROVIDERS } from '@/lib/pdf/constants';
import type { PDFProviderId } from '@/lib/pdf/types';
import { CheckCircle2 } from 'lucide-react';

function getFeatureLabel(feature: string, t: (key: string) => string): string {
  const labels: Record<string, string> = {
    text: t('settings.featureText'),
    images: t('settings.featureImages'),
    metadata: t('settings.featureMetadata'),
    'page-rendering': t('settings.featurePageRendering'),
  };
  return labels[feature] || feature;
}

interface PDFSettingsProps {
  selectedProviderId: PDFProviderId;
}

export function PDFSettings({ selectedProviderId }: PDFSettingsProps) {
  const { t } = useI18n();
  const pdfProvider = PDF_PROVIDERS[selectedProviderId];

  if (!pdfProvider) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        {t('settings.providerNotFound')}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {t('settings.pdfLocalDescription')}
        </p>
      </div>

      <div className="space-y-2">
        <Badge variant="secondary" className="font-normal text-xs">
          {t('settings.noApiKeyRequired')}
        </Badge>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">{t('settings.pdfFeatures')}</p>
        <div className="flex flex-wrap gap-2">
          {pdfProvider.features.map((feature) => (
            <Badge key={feature} variant="secondary" className="font-normal">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {getFeatureLabel(feature, t)}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
