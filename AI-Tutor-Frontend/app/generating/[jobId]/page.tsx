'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { Loader2, CheckCircle2, XCircle, Sparkles } from 'lucide-react';
import { getJob } from '@/lib/api';
import type { LessonGenerationJob } from '@/lib/api';

export default function GeneratingPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = use(params);
  const router = useRouter();
  const [job, setJob] = useState<LessonGenerationJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const data = await getJob(jobId);
        if (cancelled) return;
        setJob(data);

        if (data.status === 'succeeded' && data.lesson_id) {
          setTimeout(() => {
            if (!cancelled) router.push(`/lessons/${data.lesson_id}`);
          }, 800);
          return;
        }

        if (data.status === 'failed') {
          setError(data.message || 'Generation failed.');
          return;
        }

        // Still running — poll again
        setTimeout(() => {
          if (!cancelled) poll();
        }, 2000);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to poll job.',
          );
        }
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [jobId, router]);

  const stepLabel = job?.step
    ?.replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col items-center justify-center p-4">
      {/* Background decor */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-1/3 left-1/3 w-[500px] h-[500px] bg-purple-500/8 rounded-full blur-3xl animate-pulse"
          style={{ animationDuration: '3s' }}
        />
        <div
          className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-blue-500/8 rounded-full blur-3xl animate-pulse"
          style={{ animationDuration: '5s' }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="rounded-2xl border border-border/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-xl p-8 flex flex-col items-center gap-6">
          {/* Icon */}
          <div className="relative">
            <div className="size-16 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/25">
              {error ? (
                <XCircle className="size-8 text-white" />
              ) : job?.status === 'succeeded' ? (
                <CheckCircle2 className="size-8 text-white" />
              ) : (
                <Sparkles className="size-8 text-white animate-pulse" />
              )}
            </div>
            {!error && job?.status !== 'succeeded' && (
              <Loader2 className="absolute -top-1 -right-1 size-5 text-purple-500 animate-spin" />
            )}
          </div>

          {/* Title */}
          <div className="text-center">
            <h2 className="text-lg font-semibold text-foreground">
              {error
                ? 'Generation Failed'
                : job?.status === 'succeeded'
                  ? 'Lesson Ready!'
                  : 'Generating Your Lesson'}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {error
                ? error
                : job?.status === 'succeeded'
                  ? 'Redirecting to your lesson...'
                  : job?.message || 'Starting generation pipeline...'}
            </p>
          </div>

          {/* Progress bar */}
          {!error && job && (
            <div className="w-full space-y-2">
              <div className="relative w-full h-2 rounded-full bg-muted overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-purple-600 to-indigo-600"
                  initial={{ width: '0%' }}
                  animate={{ width: `${job.progress || 0}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{stepLabel || 'Initializing'}</span>
                <span>{job.progress || 0}%</span>
              </div>
            </div>
          )}

          {/* Retry button on error */}
          {error && (
            <button
              onClick={() => router.push('/')}
              className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Try Again
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
