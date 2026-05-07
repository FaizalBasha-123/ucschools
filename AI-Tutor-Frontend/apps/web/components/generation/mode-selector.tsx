'use client';

import Link from 'next/link';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useSettingsStore, type QualityMode, type LearningMode } from '@/lib/store/settings';
import { ChevronDown } from 'lucide-react';

// ─── Mode definitions ─────────────────────────────────────────────────────────

const QUALITY_MODES: {
  id: QualityMode;
  label: string;
  color: string;
  bg: string;
}[] = [
  {
    id: 'basic',
    label: 'Basic',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800',
  },
  {
    id: 'standard',
    label: 'Standard',
    color: 'text-blue-600',
    bg: 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800',
  },
  {
    id: 'premium',
    label: 'Premium',
    color: 'text-teal-600',
    bg: 'bg-teal-50 border-teal-200 dark:bg-teal-900/20 dark:border-teal-800',
  },
];

const LEARNING_MODES: {
  id: LearningMode;
  label: string;
  desc: string;
}[] = [
  { id: 'explain',        label: 'Explain',   desc: 'Deep structured teaching' },
  { id: 'revision',       label: 'Revision',  desc: 'Quick summaries & memory cues' },
  { id: 'exam',           label: 'Exam',       desc: 'MCQ & short-answer format' },
  { id: 'placement_prep', label: 'Placement', desc: 'Interview & aptitude prep' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ModeSelectorProps {
  /**
   * If provided, intercepts a learning mode click BEFORE the store is updated.
   * The callback decides whether/when to call setLearningMode.
   * If omitted, the store is updated directly — normal behaviour on landing page
   * and classroom page.
   */
  onLearningModeChange?: (mode: LearningMode) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ModeSelector({ onLearningModeChange }: ModeSelectorProps = {}) {
  const qualityMode  = useSettingsStore((s) => s.qualityMode);
  const learningMode = useSettingsStore((s) => s.learningMode);
  const setQualityMode  = useSettingsStore((s) => s.setQualityMode);
  const setLearningMode = useSettingsStore((s) => s.setLearningMode);

  const activeQ = QUALITY_MODES.find((q) => q.id === qualityMode)  ?? QUALITY_MODES[1];
  const activeL = LEARNING_MODES.find((l) => l.id === learningMode) ?? LEARNING_MODES[0];

  /** Quality always updates the store immediately — no confirmation needed. */
  const handleQualityClick = (mode: QualityMode) => {
    setQualityMode(mode);
  };

  /**
   * Learning mode: if the caller supplied an intercept handler (lesson studio),
   * delegate to it so it can show a confirmation dialog. Otherwise update directly.
   */
  const handleLearningClick = (mode: LearningMode) => {
    if (mode === learningMode) return; // no-op if same mode clicked
    if (onLearningModeChange) {
      onLearningModeChange(mode);
    } else {
      setLearningMode(mode);
    }
  };

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
          <span>{activeL.label}</span>
          <span className="opacity-50">·</span>
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
                onClick={() => handleQualityClick(q.id)}
                className={cn(
                  'rounded-xl border px-2 py-2 text-center transition-all text-xs font-semibold',
                  qualityMode === q.id
                    ? cn(q.bg, q.color, 'ring-1 ring-current')
                    : 'border-border/60 text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                <div>{q.label}</div>
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
                onClick={() => handleLearningClick(m.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-all text-xs',
                  learningMode === m.id
                    ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 font-semibold'
                    : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-foreground',
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold leading-none">{m.label}</div>
                  <div className="text-[10px] opacity-60 mt-0.5">{m.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Credit info link ─────────────────────────────────── */}
        <div className="text-center pt-2">
          <Link href="/pricing" className="text-xs text-blue-500 hover:underline">
            Click here to see how credits works.
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
