'use client';

import { useState } from 'react';
import { Zap, Scale } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';

type GenerationMode = 'best' | 'balanced';

export function ModeSelector() {
  const { t } = useI18n();
  const [mode] = useState<GenerationMode>('balanced');
  const [comingSoonOpen, setComingSoonOpen] = useState(false);

  const handleModeChange = (value: string) => {
    if (value === 'best') {
      setComingSoonOpen(true);
      // Don't actually change the mode — it stays on 'balanced'
    }
  };

  return (
    <>
      <Select value={mode} onValueChange={handleModeChange}>
        <SelectTrigger
          className={cn(
            'h-auto w-auto gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border transition-colors',
            'bg-sky-500/10 text-sky-700 dark:text-sky-300',
            'border-sky-500/20 dark:border-sky-500/30',
            'hover:bg-sky-500/15',
            'focus:ring-0 focus:ring-offset-0',
            '[&>svg:last-child]:size-3 [&>svg:last-child]:opacity-50',
          )}
        >
          <Scale className="size-3.5 text-sky-500" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          align="start"
          className="min-w-[200px] bg-card dark:bg-slate-900 border-border dark:border-slate-800 shadow-xl"
        >
          <SelectItem value="best" className="cursor-pointer">
            <div className="flex items-center gap-2">
              <Zap className="size-3.5 text-amber-500" />
              <div>
                <span className="font-medium">{t('toolbar.modeBest')}</span>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {t('toolbar.modeBestDesc')}
                </p>
              </div>
            </div>
          </SelectItem>
          <SelectItem value="balanced" className="cursor-pointer">
            <div className="flex items-center gap-2">
              <Scale className="size-3.5 text-sky-500" />
              <div>
                <span className="font-medium">{t('toolbar.modeBalanced')}</span>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {t('toolbar.modeBalancedDesc')}
                </p>
              </div>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>

      {/* Coming Soon Dialog */}
      <Dialog open={comingSoonOpen} onOpenChange={setComingSoonOpen}>
        <DialogContent className="sm:max-w-md bg-card dark:bg-slate-900 border-border dark:border-slate-800">
          <DialogHeader className="text-center items-center">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-amber-500/10 dark:bg-amber-500/20">
              <Zap className="size-6 text-amber-500" />
            </div>
            <DialogTitle className="text-lg font-semibold">
              {t('toolbar.modeComingSoon')}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-2">
              {t('toolbar.modeComingSoonDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center pt-2">
            <DialogClose asChild>
              <button className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity">
                {t('toolbar.modeGotIt')}
              </button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
