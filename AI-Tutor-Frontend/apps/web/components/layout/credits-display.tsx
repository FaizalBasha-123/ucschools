'use client';

import React from 'react';
import { Zap, Loader2 } from 'lucide-react';
import { useCredits } from '@/lib/contexts/credits-context';
import { cn } from '@/lib/utils';

export function CreditsDisplay() {
  const { credits, loading } = useCredits();

  // If we haven't even hydrated from cache yet, show nothing
  if (credits === null) return null;

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 shadow-sm transition-all hover:scale-105 active:scale-95 group">
      <div className="relative">
        <Zap 
          size={14} 
          className={cn(
            "text-emerald-600 fill-emerald-600 transition-all",
            loading ? "opacity-40" : "animate-pulse"
          )} 
        />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={10} className="text-emerald-600 animate-spin" />
          </div>
        )}
      </div>
      <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
        {credits} Credits
      </span>
    </div>
  );
}
