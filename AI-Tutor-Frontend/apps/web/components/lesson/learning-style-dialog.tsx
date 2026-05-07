'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sparkles, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const LEARNING_MODE_LABELS: Record<string, string> = {
  explain: 'Explain',
  revision: 'Revision',
  exam: 'Exam',
  placement_prep: 'Placement Prep',
};

const LEARNING_MODE_DESCS: Record<string, string> = {
  explain: 'Deep structured teaching with examples',
  revision: 'Quick summaries and memory cues',
  exam: 'MCQ and short-answer format',
  placement_prep: 'Interview and aptitude preparation',
};

export interface LearningStyleDialogProps {
  open: boolean;
  topic: string;
  currentMode: string;
  pendingMode: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function LearningStyleDialog({
  open,
  topic,
  currentMode,
  pendingMode,
  onConfirm,
  onCancel,
}: LearningStyleDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button when dialog opens for keyboard accessibility
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => confirmRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  const newLabel = LEARNING_MODE_LABELS[pendingMode] ?? pendingMode;
  const newDesc = LEARNING_MODE_DESCS[pendingMode] ?? '';
  const currentLabel = LEARNING_MODE_LABELS[currentMode] ?? currentMode;

  // Truncate topic to a readable length for display
  const displayTopic =
    topic && topic.length > 80 ? topic.slice(0, 80).trim() + '…' : topic || 'this lesson';

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="ls-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={onCancel}
          />

          {/* Dialog */}
          <motion.div
            key="ls-dialog"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className={cn(
                'relative w-full max-w-md rounded-2xl shadow-2xl pointer-events-auto',
                'bg-white dark:bg-neutral-900',
                'border border-neutral-200 dark:border-neutral-800',
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close */}
              <button
                onClick={onCancel}
                className="absolute top-4 right-4 p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>

              {/* Header */}
              <div className="px-6 pt-6 pb-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className="size-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/20">
                    <Sparkles className="size-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-bold text-neutral-900 dark:text-white leading-tight">
                      Change Learning Style
                    </h2>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                      {currentLabel} → {newLabel}
                    </p>
                  </div>
                </div>

                {/* Info card */}
                <div className="rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 p-3 flex gap-2.5 mb-4">
                  <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                    Switching style creates a <strong>new lesson</strong> on the same topic. Your current lesson stays accessible in the Classroom.
                  </p>
                </div>

                {/* New mode preview */}
                <div className="rounded-xl bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700/60 p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">New Style</span>
                    <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                      {newLabel}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400">{newDesc}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-500">
                    Topic: <span className="font-medium text-neutral-700 dark:text-neutral-300">{displayTopic}</span>
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 pb-6 flex gap-2.5">
                <button
                  onClick={onCancel}
                  className="flex-1 h-10 rounded-xl border border-neutral-300 dark:border-neutral-700 text-sm font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
                >
                  Keep Current
                </button>
                <button
                  ref={confirmRef}
                  onClick={onConfirm}
                  className="flex-1 h-10 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm flex items-center justify-center gap-1.5"
                >
                  <Sparkles className="size-3.5" />
                  Create New Lesson
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
