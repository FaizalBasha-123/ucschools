'use client';

import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { X, Settings } from 'lucide-react';
import type { SettingsSection } from '@/lib/types/settings';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: SettingsSection;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] p-0 overflow-hidden" showCloseButton={false}>
        <DialogTitle className="sr-only">Coming Soon</DialogTitle>
        <DialogDescription className="sr-only">Our new settings dashboard is coming soon.</DialogDescription>
        <div className="relative p-8 flex flex-col items-center text-center">
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4 text-muted-foreground hover:bg-muted"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>

          <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center mb-4 mt-2">
            <Settings className="size-6 text-primary" />
          </div>

          <h2 className="text-xl font-bold tracking-tight mb-2">Coming Soon</h2>
          <p className="text-sm text-muted-foreground mb-6">
            We are working hard to bring you a unified, enterprise-grade provider configuration dashboard. Provider selection is currently managed via backend environment variables for optimal performance and billing predictability.
          </p>

          <Button onClick={() => onOpenChange(false)} className="w-full">
            Got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
