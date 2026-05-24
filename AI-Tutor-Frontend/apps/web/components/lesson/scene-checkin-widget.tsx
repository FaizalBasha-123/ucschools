'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Brain, CheckCircle, XCircle, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CheckinStatus = 'idle' | 'loading' | 'answered' | 'dismissed';

export interface CheckinQuestion {
  id: string;
  text: string;
  options: { label: string; value: string }[];
  correctAnswer: string;
  explanation?: string;
}

export interface SceneCheckinWidgetProps {
  /** Scene number that triggered this check-in (e.g. 2, 4, 6…) */
  sceneNumber: number;
  /** Topic context shown in the header */
  lessonName: string;
  /** The comprehension question to display */
  question: CheckinQuestion;
  /** Called when the user answers — parent handles routing to chat for feedback */
  onAnswer: (questionId: string, selectedValue: string, isCorrect: boolean) => void;
  /** Called when user dismisses and wants to continue */
  onContinue: () => void;
  /** Auto-hide without checking comprehension */
  onSkip: () => void;
}

/**
 * SceneCheckinWidget — a non-blocking comprehension check shown every 2 scenes.
 *
 * Strategy:
 * - Slides in from the bottom at the scene boundary
 * - User picks an answer; feedback appears inline (correct/wrong + explanation)
 * - "Continue" advances the lesson; the AI tutor chat has context for follow-up
 */
export function SceneCheckinWidget({
  sceneNumber,
  lessonName,
  question,
  onAnswer,
  onContinue,
  onSkip,
}: SceneCheckinWidgetProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  const isCorrect = selected === question.correctAnswer;

  const handleSelect = useCallback(
    (value: string) => {
      if (revealed) return;
      setSelected(value);
      setRevealed(true);
      onAnswer(question.id, value, value === question.correctAnswer);
    },
    [revealed, question.id, question.correctAnswer, onAnswer],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ type: 'spring', stiffness: 340, damping: 28 }}
      className={cn(
        'fixed bottom-40 left-1/2 -translate-x-1/2 z-40',
        'w-full max-w-lg px-4',
      )}
    >
      <div
        className={cn(
          'rounded-2xl border overflow-hidden',
          'bg-white/97 dark:bg-neutral-900/97 backdrop-blur-xl',
          'border-violet-200/60 dark:border-violet-700/40',
          'shadow-2xl shadow-violet-500/10',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-violet-50/80 dark:bg-violet-950/40 border-b border-violet-100 dark:border-violet-800/40">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm shadow-violet-500/30">
              <Brain className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-violet-600 dark:text-violet-400 uppercase tracking-widest">
                Quick Check · Scene {sceneNumber}
              </p>
              <p className="text-[10px] text-violet-400 dark:text-violet-500 truncate max-w-[220px]">
                {lessonName.length > 32 ? lessonName.slice(0, 32) + '…' : lessonName}
              </p>
            </div>
          </div>
          <button
            onClick={onSkip}
            className="text-xs text-violet-400 dark:text-violet-500 hover:text-violet-600 dark:hover:text-violet-300 transition-colors px-2 py-1 rounded-lg hover:bg-violet-100/60 dark:hover:bg-violet-800/40"
          >
            Skip
          </button>
        </div>

        {/* Question */}
        <div className="px-5 pt-4 pb-3">
          <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-100 leading-relaxed">
            {question.text}
          </p>
        </div>

        {/* Options */}
        <div className="px-5 pb-4 space-y-2">
          {question.options.map((opt) => {
            const isSelected = selected === opt.value;
            const isCorrectOpt = opt.value === question.correctAnswer;
            let btnStyle = 'bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 hover:border-violet-300 dark:hover:border-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/40';

            if (revealed) {
              if (isCorrectOpt) {
                btnStyle = 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-600';
              } else if (isSelected && !isCorrectOpt) {
                btnStyle = 'bg-rose-50 dark:bg-rose-950/40 border-rose-400 dark:border-rose-600';
              } else {
                btnStyle = 'bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 opacity-50';
              }
            }

            return (
              <button
                key={opt.value}
                id={`checkin-opt-${opt.value}`}
                onClick={() => handleSelect(opt.value)}
                disabled={revealed}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all',
                  btnStyle,
                  !revealed && 'cursor-pointer active:scale-[0.99]',
                  revealed && 'cursor-default',
                )}
              >
                <span
                  className={cn(
                    'h-6 w-6 rounded-lg border text-[11px] font-bold flex items-center justify-center shrink-0',
                    revealed && isCorrectOpt
                      ? 'border-emerald-400 text-emerald-600 bg-emerald-100 dark:bg-emerald-900/40'
                      : revealed && isSelected
                      ? 'border-rose-400 text-rose-600 bg-rose-100 dark:bg-rose-900/40'
                      : 'border-neutral-300 dark:border-neutral-600 text-neutral-500',
                  )}
                >
                  {opt.value}
                </span>
                <span className="text-sm text-neutral-700 dark:text-neutral-300 leading-snug">
                  {opt.label}
                </span>
                {revealed && isCorrectOpt && (
                  <CheckCircle className="w-4 h-4 text-emerald-500 ml-auto shrink-0" />
                )}
                {revealed && isSelected && !isCorrectOpt && (
                  <XCircle className="w-4 h-4 text-rose-500 ml-auto shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* Feedback + continue */}
        <AnimatePresence>
          {revealed && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div
                className={cn(
                  'px-5 py-3.5 border-t text-sm',
                  isCorrect
                    ? 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-100 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-400'
                    : 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-100 dark:border-amber-800/40 text-amber-700 dark:text-amber-400',
                )}
              >
                <p className="font-semibold mb-0.5">
                  {isCorrect ? '🎉 Correct! Great understanding.' : '💡 Not quite — let\'s review.'}
                </p>
                {question.explanation && (
                  <p className="text-xs opacity-80 leading-relaxed">{question.explanation}</p>
                )}
              </div>

              <div className="px-5 py-3 border-t border-neutral-100 dark:border-neutral-800 flex justify-end">
                <button
                  id="checkin-continue-btn"
                  onClick={onContinue}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-md shadow-violet-500/25"
                >
                  Continue lesson
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/**
 * Hook to manage the check-in lifecycle.
 * Triggers at every CHECKIN_INTERVAL scenes that have been viewed.
 */
export const CHECKIN_INTERVAL = 2; // every 2 scenes

export interface UseCheckinOptions {
  /** Called when a new check-in should be shown — caller fetches/generates the question */
  onTrigger: (sceneIndex: number) => void;
}

export function useSceneCheckin({ onTrigger }: UseCheckinOptions) {
  const [lastCheckinAt, setLastCheckinAt] = useState<number>(-1);

  /** Call this each time the scene index advances */
  const onSceneAdvance = useCallback(
    (sceneIndex: number) => {
      if (sceneIndex <= 0) return;
      if (sceneIndex % CHECKIN_INTERVAL === 0 && sceneIndex !== lastCheckinAt) {
        setLastCheckinAt(sceneIndex);
        onTrigger(sceneIndex);
      }
    },
    [lastCheckinAt, onTrigger],
  );

  const resetCheckin = useCallback(() => {
    setLastCheckinAt(-1);
  }, []);

  return { onSceneAdvance, resetCheckin };
}
