'use client';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useSettingsStore, type QualityMode, type LearningMode } from '@/lib/store/settings';
import { ChevronDown } from 'lucide-react';

// ─── Mode definitions ─────────────────────────────────────────────────────────

const QUALITY_MODES: {
  id: QualityMode;
  label: string;
  emoji: string;
  voice: string;
  color: string;
  bg: string;
}[] = [
  {
    id: 'basic',
    label: 'Basic',
    emoji: '⚡',
    voice: '~0.4 cr/min',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800',
  },
  {
    id: 'standard',
    label: 'Standard',
    emoji: '🚀',
    voice: '~0.8 cr/min',
    color: 'text-blue-600',
    bg: 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800',
  },
  {
    id: 'premium',
    label: 'Premium',
    emoji: '✨',
    voice: '~1.5 cr/min',
    color: 'text-amber-600',
    bg: 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800',
  },
];

const LEARNING_MODES: {
  id: LearningMode;
  label: string;
  emoji: string;
  mul: number;
  desc: string;
}[] = [
  { id: 'explain',        label: 'Explain',   emoji: '🧠', mul: 1.6, desc: 'Deep structured teaching' },
  { id: 'revision',       label: 'Revision',  emoji: '⚡', mul: 0.6, desc: 'Quick summaries & memory cues' },
  { id: 'exam',           label: 'Exam',       emoji: '📝', mul: 1.3, desc: 'MCQ & short-answer format' },
  { id: 'placement_prep', label: 'Placement', emoji: '🎯', mul: 2.0, desc: 'Interview & aptitude prep' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function ModeSelector() {
  const qualityMode  = useSettingsStore((s) => s.qualityMode);
  const learningMode = useSettingsStore((s) => s.learningMode);
  const setQualityMode  = useSettingsStore((s) => s.setQualityMode);
  const setLearningMode = useSettingsStore((s) => s.setLearningMode);

  const activeQ = QUALITY_MODES.find((q) => q.id === qualityMode)  ?? QUALITY_MODES[1];
  const activeL = LEARNING_MODES.find((l) => l.id === learningMode) ?? LEARNING_MODES[0];

  // Base credit rate (credits/min) × learning multiplier
  const baseRate    = qualityMode === 'premium' ? 1.5 : qualityMode === 'standard' ? 0.8 : 0.4;
  const estimatedRate = (baseRate * activeL.mul).toFixed(2);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold',
            'transition-all shadow-sm hover:shadow',
            activeQ.bg,
            activeQ.color,
          )}
        >
          <span>{activeL.emoji}</span>
          <span>{activeL.label}</span>
          <span className="opacity-50">·</span>
          <span>{activeQ.emoji}</span>
          <span>{activeQ.label}</span>
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-72 p-3 bg-card dark:bg-neutral-900 border-border dark:border-neutral-800 shadow-2xl rounded-2xl space-y-4"
      >
        {/* ── AI Quality tier ──────────────────────────────────── */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
            AI Quality
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {QUALITY_MODES.map((q) => (
              <button
                key={q.id}
                onClick={() => setQualityMode(q.id)}
                className={cn(
                  'rounded-xl border px-2 py-2 text-left transition-all text-xs font-semibold',
                  qualityMode === q.id
                    ? cn(q.bg, q.color, 'ring-1 ring-current')
                    : 'border-border/60 text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                <div className="text-base leading-none mb-1">{q.emoji}</div>
                <div>{q.label}</div>
                <div className="text-[10px] font-normal opacity-60 mt-0.5">🎧 {q.voice}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Learning Style ───────────────────────────────────── */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
            Learning Style
          </p>
          <div className="space-y-1">
            {LEARNING_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setLearningMode(m.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-all text-xs',
                  learningMode === m.id
                    ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 font-semibold'
                    : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-foreground',
                )}
              >
                <span className="text-base shrink-0">{m.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold leading-none">{m.label}</div>
                  <div className="text-[10px] opacity-60 mt-0.5">{m.desc}</div>
                </div>
                <span className="opacity-50 shrink-0 tabular-nums">
                  {m.mul.toFixed(1)}×
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Estimated credit burn ────────────────────────────── */}
        <div className="rounded-xl bg-neutral-50 dark:bg-neutral-800/60 px-3 py-2 text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">~{estimatedRate} credits/min</span>
            <span className="text-[10px] opacity-60">{activeL.mul.toFixed(1)}×</span>
          </div>
          <div className="text-[10px] opacity-70 mt-0.5">🎧 Voice → {activeQ.voice}</div>
          <div className="text-[10px]">for {activeL.label} + {activeQ.label} mode</div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
