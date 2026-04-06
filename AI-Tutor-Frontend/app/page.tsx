'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUp, Sun, Moon, Monitor, Sparkles } from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { generateLessonAsync } from '@/lib/api';
import type { GenerateLessonPayload } from '@/lib/api';
import { toast } from 'sonner';

export default function HomePage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const [requirement, setRequirement] = useState('');
  const [language, setLanguage] = useState<'en-US' | 'zh-CN'>('en-US');
  const [enableTts, setEnableTts] = useState(false);
  const [enableImages, setEnableImages] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);

  const canGenerate = !!requirement.trim();

  const handleGenerate = async () => {
    if (!canGenerate || isSubmitting) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const payload: GenerateLessonPayload = {
        requirement,
        language,
        enable_tts: enableTts,
        enable_image_generation: enableImages,
      };

      const response = await generateLessonAsync(payload);
      router.push(`/generating/${response.job_id}`);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to start generation.';
      setError(msg);
      toast.error(msg);
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canGenerate) handleGenerate();
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col items-center p-4 pt-16 md:p-8 md:pt-16 overflow-x-hidden">
      {/* ═══ Top-right pill ═══ */}
      <div className="fixed top-4 right-4 z-50 flex items-center gap-1 bg-white/60 dark:bg-gray-800/60 backdrop-blur-md px-2 py-1.5 rounded-full border border-gray-100/50 dark:border-gray-700/50 shadow-sm">
        {/* Theme selector */}
        <div className="relative">
          <button
            onClick={() => setThemeOpen(!themeOpen)}
            className="p-2 rounded-full text-gray-400 dark:text-gray-500 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm transition-all"
          >
            {theme === 'light' && <Sun className="w-4 h-4" />}
            {theme === 'dark' && <Moon className="w-4 h-4" />}
            {(theme === 'system' || !theme) && <Monitor className="w-4 h-4" />}
          </button>
          {themeOpen && (
            <div className="absolute top-full mt-2 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden z-50 min-w-[140px]">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setTheme(t);
                    setThemeOpen(false);
                  }}
                  className={cn(
                    'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2',
                    theme === t &&
                      'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
                  )}
                >
                  {t === 'light' && <Sun className="w-4 h-4" />}
                  {t === 'dark' && <Moon className="w-4 h-4" />}
                  {t === 'system' && <Monitor className="w-4 h-4" />}
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ═══ Background decor ═══ */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse"
          style={{ animationDuration: '4s' }}
        />
        <div
          className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse"
          style={{ animationDuration: '6s' }}
        />
      </div>

      {/* ═══ Hero ═══ */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="relative z-20 w-full max-w-[800px] flex flex-col items-center justify-center min-h-[calc(100dvh-8rem)]"
      >
        {/* Logo / Title */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 200, damping: 20 }}
          className="flex items-center gap-3 mb-2"
        >
          <div className="size-12 md:size-14 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/25">
            <Sparkles className="size-6 md:size-7 text-white" />
          </div>
          <h1 className="text-3xl md:text-5xl font-bold bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 bg-clip-text text-transparent">
            AI Tutor
          </h1>
        </motion.div>

        {/* Slogan */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="text-sm text-muted-foreground/60 mb-8"
        >
          Prompt-to-lesson in seconds — powered by AI
        </motion.p>

        {/* ═══ Input area ═══ */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.35 }}
          className="w-full"
        >
          <div className="w-full rounded-2xl border border-border/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-xl shadow-black/[0.03] dark:shadow-black/20 transition-shadow focus-within:shadow-2xl focus-within:shadow-violet-500/[0.06]">
            <textarea
              placeholder="Teach fractions to a 5th grader using real-life examples, then end with a quiz..."
              className="w-full resize-none border-0 bg-transparent px-4 pt-5 pb-2 text-[13px] leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none min-h-[140px] max-h-[300px]"
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
            />

            {/* Toolbar row */}
            <div className="px-3 pb-3 flex items-end gap-2">
              <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                {/* Language */}
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as 'en-US' | 'zh-CN')}
                  className="h-8 rounded-lg border border-border/60 bg-muted/40 px-2 text-xs text-muted-foreground cursor-pointer hover:bg-muted/60 transition-colors"
                >
                  <option value="en-US">English</option>
                  <option value="zh-CN">中文</option>
                </select>

                {/* TTS toggle */}
                <button
                  onClick={() => setEnableTts(!enableTts)}
                  className={cn(
                    'h-8 rounded-lg border px-3 text-xs transition-all',
                    enableTts
                      ? 'border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                      : 'border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted/60',
                  )}
                >
                  🔊 Audio
                </button>

                {/* Image toggle */}
                <button
                  onClick={() => setEnableImages(!enableImages)}
                  className={cn(
                    'h-8 rounded-lg border px-3 text-xs transition-all',
                    enableImages
                      ? 'border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                      : 'border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted/60',
                  )}
                >
                  🖼️ Images
                </button>

                {/* Video — Coming Soon */}
                <span
                  className="h-8 rounded-lg border border-dashed border-border/40 bg-muted/20 px-3 text-xs text-muted-foreground/40 flex items-center gap-1.5 cursor-not-allowed select-none"
                  title="Video generation coming soon"
                >
                  🎬 Video
                  <span className="text-[10px] font-medium bg-muted/60 text-muted-foreground/50 rounded px-1.5 py-0.5 leading-none">
                    Soon
                  </span>
                </span>
              </div>

              {/* Submit */}
              <button
                onClick={handleGenerate}
                disabled={!canGenerate || isSubmitting}
                className={cn(
                  'shrink-0 h-8 rounded-lg flex items-center justify-center gap-1.5 transition-all px-4',
                  canGenerate && !isSubmitting
                    ? 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm cursor-pointer'
                    : 'bg-muted text-muted-foreground/40 cursor-not-allowed',
                )}
              >
                <span className="text-xs font-medium">
                  {isSubmitting ? 'Generating...' : 'Generate lesson'}
                </span>
                <ArrowUp className="size-3.5" />
              </button>
            </div>
          </div>
        </motion.div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 w-full p-3 bg-destructive/10 border border-destructive/20 rounded-lg"
            >
              <p className="text-sm text-destructive">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Footer */}
      <div className="mt-auto pt-12 pb-4 text-center text-xs text-muted-foreground/40">
        AI Tutor — Powered by OpenMAIC Architecture
      </div>
    </div>
  );
}
