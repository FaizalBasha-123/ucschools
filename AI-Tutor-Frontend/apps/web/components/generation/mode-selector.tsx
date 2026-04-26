'use client';

import { Zap, Scale } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';

export function ModeSelector() {
  const { t } = useI18n();
  const generationMode = useSettingsStore((s) => s.generationMode);
  const setGenerationMode = useSettingsStore((s) => s.setGenerationMode);

  return (
    <Select
      value={generationMode}
      onValueChange={(v) => setGenerationMode(v as 'best' | 'balanced')}
    >
      <SelectTrigger
        className={cn(
          'h-auto w-auto gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border transition-all duration-300 shadow-sm',
          generationMode === 'best'
            ? 'bg-gradient-to-r from-amber-500/10 to-orange-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:border-amber-500/50 hover:from-amber-500/15 hover:to-orange-500/15'
            : 'bg-gradient-to-r from-sky-500/10 to-blue-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30 hover:border-sky-500/50 hover:from-sky-500/15 hover:to-blue-500/15',
          'focus:ring-2 focus:ring-primary/20 focus:ring-offset-0',
          '[&>svg:last-child]:size-3 [&>svg:last-child]:opacity-70',
        )}
      >
        {generationMode === 'best' ? (
          <Zap className="size-3.5 text-amber-500 animate-pulse" />
        ) : (
          <Scale className="size-3.5 text-sky-500" />
        )}
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        align="start"
        className="min-w-[220px] bg-card/95 backdrop-blur-md dark:bg-slate-900/95 border-border/50 dark:border-slate-800/50 shadow-2xl rounded-xl p-1"
      >
        <SelectItem 
          value="best" 
          className="cursor-pointer rounded-lg mb-1 data-[state=checked]:bg-amber-500/10 data-[state=checked]:text-amber-700 dark:data-[state=checked]:text-amber-300 transition-colors"
        >
          <div className="flex items-center gap-3 py-1">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-amber-500/20 text-amber-500">
              <Zap className="size-4" />
            </div>
            <div className="flex flex-col">
              <span className="font-semibold">{t('toolbar.modeBest')}</span>
              <span className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                {t('toolbar.modeBestDesc')}
              </span>
            </div>
          </div>
        </SelectItem>
        <SelectItem 
          value="balanced" 
          className="cursor-pointer rounded-lg data-[state=checked]:bg-sky-500/10 data-[state=checked]:text-sky-700 dark:data-[state=checked]:text-sky-300 transition-colors"
        >
          <div className="flex items-center gap-3 py-1">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sky-500/20 text-sky-500">
              <Scale className="size-4" />
            </div>
            <div className="flex flex-col">
              <span className="font-semibold">{t('toolbar.modeBalanced')}</span>
              <span className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                {t('toolbar.modeBalancedDesc')}
              </span>
            </div>
          </div>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
