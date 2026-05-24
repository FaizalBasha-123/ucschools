'use client';

import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Zap, X, ChevronRight, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MaxScenesDialogProps {
  open: boolean;
  /** The lesson topic/title for context copy */
  lessonName: string;
  /** Hard cap from backend (plan tier + complexity) */
  maxScenes: number;
  /** Current number of scenes already generated */
  currentScenes: number;
  /** Estimated extra credit cost reported by the consent gate */
  estimatedExtraCost?: number;
  /** User consents to extend — caller handles actual generation */
  onConsent: () => void;
  /** User declines — we route their message to the chat agent instead */
  onDecline: () => void;
  onClose: () => void;
}

/**
 * MaxScenesDialog — appears when the user types into the Studio bar asking for
 * more content, but the lesson has already reached its hard scene cap.
 *
 * UX path:
 *   ✅ "Yes, extend it"  →  onConsent()  (caller sets extra_scenes_consented=true and re-generates)
 *   💬 "Just chat"       →  onDecline() (caller routes message to the chat AI instead)
 */
export function MaxScenesDialog({
  open,
  lessonName,
  maxScenes,
  currentScenes,
  estimatedExtraCost,
  onConsent,
  onDecline,
  onClose,
}: MaxScenesDialogProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Dialog */}
          <motion.div
            key="dialog"
            initial={{ opacity: 0, y: 32, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className={cn(
              'fixed inset-x-0 bottom-4 z-50 mx-auto w-full max-w-md px-4',
              'md:bottom-auto md:top-1/2 md:-translate-y-1/2',
            )}
          >
            <div className="rounded-3xl bg-white dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800 shadow-2xl shadow-black/20 overflow-hidden">
              {/* Close */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-1.5 rounded-xl text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Header */}
              <div className="px-6 pt-6 pb-4 text-center">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-orange-500/30 mb-4">
                  <Zap className="w-7 h-7 text-white" />
                </div>
                <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-1">
                  Scene limit reached
                </h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                    {lessonName.length > 40 ? lessonName.slice(0, 40) + '…' : lessonName}
                  </span>{' '}
                  already has{' '}
                  <span className="font-semibold">{currentScenes}</span> of{' '}
                  <span className="font-semibold">{maxScenes}</span> scenes for your plan.
                </p>
              </div>

              {/* Options */}
              <div className="px-6 pb-6 space-y-3">
                {/* Extend option */}
                <button
                  id="max-scenes-extend-btn"
                  onClick={onConsent}
                  className="w-full group flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-400 hover:to-teal-500 transition-all shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:scale-[1.01] active:scale-[0.99]"
                >
                  <div className="h-9 w-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-bold text-sm">Generate extended lesson</p>
                    <p className="text-xs text-white/75">
                      {estimatedExtraCost != null
                        ? `~${estimatedExtraCost.toFixed(0)} extra credits · complex topics only`
                        : 'Add more scenes · complex topics only'}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 opacity-70 group-hover:translate-x-0.5 transition-transform" />
                </button>

                {/* Chat option */}
                <button
                  id="max-scenes-chat-btn"
                  onClick={onDecline}
                  className="w-full flex items-center gap-4 p-4 rounded-2xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-all"
                >
                  <div className="h-9 w-9 rounded-xl bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center shrink-0">
                    <Lock className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-sm text-neutral-800 dark:text-neutral-200">
                      Just ask the AI tutor
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Chat about the topic — no extra credits
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-neutral-400" />
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
