'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Mic, MicOff, ArrowUp, Loader2, Sparkles, X, Globe, FileText } from 'lucide-react';
import { GenerationToolbar } from '@/components/generation/generation-toolbar';
import { ModeSelector } from '@/components/generation/mode-selector';
import type { LearningMode } from '@/lib/store/settings';
import { motion, AnimatePresence } from 'motion/react';

interface StudioInputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isSubmitting?: boolean;
  error?: string | null;
  stageName?: string;
  language: string;
  onLanguageChange: (lang: string) => void;
  pdfFile: File | null;
  onPdfFileChange: (f: File | null) => void;
  onLearningModeChange?: (mode: LearningMode) => void;
  isOpen: boolean;
  onToggle: () => void;
  className?: string;
}

/**
 * Enterprise Teaching Studio input bar.
 * Features: auto-resize textarea, ASR voice input, animated send button, mode controls.
 */
export function StudioInputBar({
  value,
  onChange,
  onSubmit,
  isSubmitting,
  error,
  stageName,
  language,
  onLanguageChange,
  pdfFile,
  onPdfFileChange,
  onLearningModeChange,
  isOpen,
  onToggle,
  className,
}: StudioInputBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const canSubmit = value.trim().length > 0 && !isSubmitting;

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  // Detect SpeechRecognition support
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVoiceSupported(
        'SpeechRecognition' in window || 'webkitSpeechRecognition' in window,
      );
    }
  }, []);

  const startListening = useCallback(() => {
    if (!voiceSupported) return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition: any = new SpeechRecognition();
    recognition.lang = language || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      onChange(value ? `${value} ${transcript}` : transcript);
      setIsListening(false);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [voiceSupported, language, value, onChange]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit) onSubmit();
    }
  };

  return (
    <div className={cn('w-full', className)}>
      <AnimatePresence mode="wait">
        {isOpen ? (
          <motion.div
            key="open"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              'rounded-2xl border border-border/50 overflow-hidden',
              'bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl',
              'shadow-2xl shadow-black/[0.08] dark:shadow-black/40',
              'transition-shadow focus-within:shadow-[0_8px_40px_rgba(16,185,129,0.15)]',
              'focus-within:border-emerald-500/40',
            )}
          >
            {/* Header row */}
            <div className="flex items-center px-4 pt-3 pb-1.5 gap-2 border-b border-border/30">
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <div className="h-5 w-5 rounded-md bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-sm">
                  <Sparkles className="w-2.5 h-2.5 text-white" />
                </div>
                <span className="text-[11px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-widest">
                  Studio
                </span>
                {stageName && (
                  <>
                    <span className="text-neutral-300 dark:text-neutral-700">·</span>
                    <span className="text-[11px] text-neutral-400 dark:text-neutral-500 truncate max-w-[180px]">
                      {stageName.length > 45 ? stageName.slice(0, 45) + '…' : stageName}
                    </span>
                  </>
                )}
              </div>
              <button
                onClick={onToggle}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors shrink-0"
                title="Collapse studio"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder={
                isListening
                  ? 'Listening… speak now'
                  : 'Ask a question, request a new lesson, or explore a related topic…'
              }
              className={cn(
                'w-full resize-none border-0 bg-transparent px-4 py-3',
                'text-[14px] leading-relaxed text-foreground',
                'placeholder:text-muted-foreground/40 focus:outline-none',
                'min-h-[40px] max-h-[160px] overflow-y-auto scrollbar-hide',
                isListening && 'placeholder:text-emerald-500/60',
              )}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isListening}
            />

            {/* Toolbar row */}
            <div className="px-3 pb-3 flex items-center gap-2">
              <div className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto scrollbar-hide">
                <GenerationToolbar
                  language={language}
                  onLanguageChange={onLanguageChange}
                  onSettingsOpen={() => {}}
                  pdfFile={pdfFile}
                  onPdfFileChange={onPdfFileChange}
                  onPdfError={() => {}}
                />
                {onLearningModeChange && (
                  <ModeSelector onLearningModeChange={onLearningModeChange} />
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* Voice input button */}
                {voiceSupported && (
                  <button
                    onClick={isListening ? stopListening : startListening}
                    className={cn(
                      'h-8 w-8 rounded-lg flex items-center justify-center transition-all',
                      isListening
                        ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30 animate-pulse'
                        : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                    title={isListening ? 'Stop listening' : 'Voice input'}
                  >
                    {isListening ? (
                      <MicOff className="w-3.5 h-3.5" />
                    ) : (
                      <Mic className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}

                {/* Send button */}
                <button
                  onClick={onSubmit}
                  disabled={!canSubmit}
                  className={cn(
                    'relative h-8 rounded-lg flex items-center justify-center transition-all overflow-hidden',
                    canSubmit
                      ? 'w-8 bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30 hover:shadow-lg hover:shadow-emerald-500/40 hover:scale-105 cursor-pointer'
                      : 'w-8 bg-muted text-muted-foreground/40 cursor-not-allowed',
                  )}
                  title="Generate lesson (Enter)"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ArrowUp className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="px-4 pb-3 text-xs text-rose-500 dark:text-rose-400">{error}</p>
            )}
          </motion.div>
        ) : (
          <motion.button
            key="closed"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onClick={onToggle}
            className="mx-auto flex items-center gap-2 px-4 py-2 rounded-full bg-white/90 dark:bg-neutral-900/90 border border-border/50 shadow-lg text-sm font-medium text-neutral-500 dark:text-neutral-400 hover:border-emerald-400/50 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Open Studio
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
