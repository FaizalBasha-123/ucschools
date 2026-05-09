'use client';

import { cn } from '@/lib/utils';
import { useStageStore } from '@/lib/store';
import { PENDING_SCENE_ID } from '@/lib/store/stage';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, Zap } from 'lucide-react';

interface StudioSceneStripProps {
  onSceneSelect: (sceneId: string) => void;
  className?: string;
  orientation?: 'vertical' | 'horizontal';
}

/**
 * Filmstrip-style scene navigator for the Teaching Studio.
 * Vertical on desktop, horizontal on mobile.
 */
export function StudioSceneStrip({
  onSceneSelect,
  className,
  orientation = 'vertical',
}: StudioSceneStripProps) {
  const { scenes, currentSceneId, generatingOutlines } = useStageStore();

  const isVertical = orientation === 'vertical';

  return (
    <div
      className={cn(
        'flex gap-2 overflow-auto scrollbar-hide',
        isVertical
          ? 'flex-col w-[72px] shrink-0 py-3 px-2'
          : 'flex-row h-[80px] shrink-0 px-3 py-2',
        className,
      )}
    >
      <AnimatePresence initial={false}>
        {scenes.map((scene, idx) => {
          const isActive = scene.id === currentSceneId;
          const isQuiz = scene.type === 'quiz';
          const isInteractive = scene.type === 'interactive' || scene.type === 'pbl';

          return (
            <motion.button
              key={scene.id}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.2 }}
              onClick={() => onSceneSelect(scene.id)}
              className={cn(
                'relative group shrink-0 flex flex-col items-center justify-center rounded-xl border transition-all duration-200 overflow-hidden',
                isVertical ? 'w-full aspect-video min-h-[44px]' : 'w-[72px] h-full',
                isActive
                  ? 'border-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.3)] bg-emerald-500/10 dark:bg-emerald-500/10'
                  : 'border-border/50 bg-white/60 dark:bg-neutral-800/60 hover:border-emerald-400/50 hover:bg-emerald-50/30 dark:hover:bg-emerald-900/20',
              )}
              title={scene.title || `Scene ${idx + 1}`}
            >
              {/* Scene number badge */}
              <span
                className={cn(
                  'text-[9px] font-black tabular-nums leading-none',
                  isActive
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-neutral-400 dark:text-neutral-500',
                )}
              >
                {idx + 1}
              </span>

              {/* Scene type indicator */}
              {isQuiz && (
                <span className="mt-1 text-[8px] font-bold text-amber-500 uppercase tracking-wide">
                  Quiz
                </span>
              )}
              {isInteractive && (
                <span className="mt-1 text-[8px] font-bold text-indigo-500 uppercase tracking-wide">
                  Live
                </span>
              )}

              {/* Active glow dot */}
              {isActive && (
                <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
              )}

              {/* Hover title tooltip (vertical only) */}
              {isVertical && (
                <div className="absolute left-full ml-2 z-50 hidden group-hover:flex items-center pointer-events-none">
                  <div className="bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg max-w-[200px] truncate">
                    {scene.title || `Scene ${idx + 1}`}
                  </div>
                  <div className="w-0 h-0 border-y-4 border-y-transparent border-r-4 border-r-neutral-900 dark:border-r-neutral-100 -ml-[1px]" />
                </div>
              )}
            </motion.button>
          );
        })}

        {/* Generating placeholder */}
        {generatingOutlines.length > 0 && (
          <motion.div
            key="generating"
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={cn(
              'shrink-0 flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300/60 dark:border-emerald-700/40 bg-emerald-50/30 dark:bg-emerald-900/10',
              isVertical ? 'w-full aspect-video min-h-[44px]' : 'w-[72px] h-full',
            )}
          >
            <Loader2 className="w-3 h-3 text-emerald-500 animate-spin" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
