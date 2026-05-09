'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import {
  CheckCircle2,
  Info,
  AlertTriangle,
  XCircle,
  Loader2,
} from 'lucide-react';

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      position="bottom-right"
      expand={false}
      richColors
      closeButton
      swipeDirections={['right', 'left']}
      duration={4500}
      icons={{
        success: (
          <span className="flex items-center justify-center size-5 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/30">
            <CheckCircle2 className="size-3.5 text-white stroke-[2.5]" />
          </span>
        ),
        info: (
          <span className="flex items-center justify-center size-5 rounded-full bg-blue-500 shadow-lg shadow-blue-500/30">
            <Info className="size-3.5 text-white stroke-[2.5]" />
          </span>
        ),
        warning: (
          <span className="flex items-center justify-center size-5 rounded-full bg-amber-500 shadow-lg shadow-amber-500/30">
            <AlertTriangle className="size-3.5 text-white stroke-[2.5]" />
          </span>
        ),
        error: (
          <span className="flex items-center justify-center size-5 rounded-full bg-rose-500 shadow-lg shadow-rose-500/30">
            <XCircle className="size-3.5 text-white stroke-[2.5]" />
          </span>
        ),
        loading: (
          <span className="flex items-center justify-center size-5 rounded-full bg-violet-500/20 border border-violet-400/30">
            <Loader2 className="size-3.5 text-violet-500 animate-spin" />
          </span>
        ),
      }}
      toastOptions={{
        classNames: {
          toast: [
            'group flex items-start gap-3 w-full rounded-2xl border px-4 py-3.5 shadow-xl shadow-black/10',
            'bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl',
            'border-neutral-200/60 dark:border-neutral-700/60',
            'text-neutral-800 dark:text-neutral-100',
            'font-medium text-sm',
            'transition-all duration-300',
            'data-[type=success]:border-emerald-200/60 dark:data-[type=success]:border-emerald-700/30',
            'data-[type=success]:bg-emerald-50/95 dark:data-[type=success]:bg-emerald-950/70',
            'data-[type=error]:border-rose-200/60 dark:data-[type=error]:border-rose-700/30',
            'data-[type=error]:bg-rose-50/95 dark:data-[type=error]:bg-rose-950/70',
            'data-[type=warning]:border-amber-200/60 dark:data-[type=warning]:border-amber-700/30',
            'data-[type=warning]:bg-amber-50/95 dark:data-[type=warning]:bg-amber-950/70',
            'data-[type=info]:border-blue-200/60 dark:data-[type=info]:border-blue-700/30',
            'data-[type=info]:bg-blue-50/95 dark:data-[type=info]:bg-blue-950/70',
          ].join(' '),
          title: 'font-semibold text-sm leading-snug',
          description: 'text-xs opacity-75 mt-0.5 leading-relaxed',
          actionButton: [
            'mt-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
            'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900',
            'hover:opacity-80',
          ].join(' '),
          cancelButton: [
            'mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
            'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
            'hover:bg-neutral-200 dark:hover:bg-neutral-700',
          ].join(' '),
          closeButton: [
            'absolute top-2 right-2 size-5 rounded-full flex items-center justify-center',
            'opacity-0 group-hover:opacity-100 transition-opacity',
            'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200',
            'hover:bg-neutral-100 dark:hover:bg-neutral-800',
          ].join(' '),
        },
      }}
      style={
        {
          '--width': '360px',
          '--offset': '20px',
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
