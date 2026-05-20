'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import {
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  XCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useStageStore } from '@/lib/store/stage';
import { useSettingsStore } from '@/lib/store/settings';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createLogger } from '@/lib/logger';
import { hasAuthSessionHint, getSessionToken } from '@/lib/auth/session';
import { loadPdfBlob } from '@/lib/utils/image-storage';
import { type GenerationSessionState } from './types';

const log = createLogger('GenerationPreview');

const STEPS = [
  { id: 'submit', title: 'Submitting request', description: 'Sending to AI tutor backend' },
  { id: 'generate', title: 'Generating lesson', description: 'Outlines, scenes, actions & media' },
  { id: 'complete', title: 'Finalizing', description: 'Preparing your lesson' },
];

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Remove data:application/pdf;base64, prefix if present
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function GenerationPreviewContent() {
  const router = useRouter();
  const { t } = useI18n();

  const [session, setSession] = useState<GenerationSessionState | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');

  // Load session from sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem('generationSession');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as GenerationSessionState;
        setSession(parsed);
      } catch (e) {
        log.error('Failed to parse generation session:', e);
      }
    }
    setSessionLoaded(true);
  }, []);

  useEffect(() => {
    if (!sessionLoaded) return;
    if (!hasAuthSessionHint()) {
      router.replace('/auth?next=/');
      return;
    }
    if (session) {
      startGeneration();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoaded, session]);

  const startGeneration = async () => {
    if (!session) return;
    setError(null);
    setCurrentStepIndex(0);

    try {
      // Step 0: Build payload
      const settings = useSettingsStore.getState();
      const payload: Record<string, unknown> = {
        requirement: session.requirements.requirement,
        language: session.requirements.language || 'en-US',
        quality_mode: session.qualityMode || settings.qualityMode || 'standard',
        learning_mode: session.learningMode || settings.learningMode || 'explain',
        enable_image_generation: settings.imageGenerationEnabled ?? false,
        enable_video_generation: settings.videoGenerationEnabled ?? false,
        enable_tts: settings.ttsEnabled ?? false,
        user_nickname: session.requirements.userNickname,
      };

      // Attach raw PDF as base64 if available
      let pdfBase64: string | undefined;
      if (session.pdfStorageKey) {
        setStatusMessage('Reading PDF...');
        const pdfBlob = await loadPdfBlob(session.pdfStorageKey);
        if (pdfBlob) {
          pdfBase64 = await blobToBase64(pdfBlob);
          payload.pdf_text = pdfBase64;
        }
      } else if (session.pdfText) {
        // Fallback: if PDF was already parsed, don't send text as base64
        // (Rust expects base64 PDF bytes, not parsed text)
        log.warn('PDF already parsed; sending without PDF context to Rust backend');
      }

      setCurrentStepIndex(1);
      setStatusMessage('Generating outlines, scenes, actions & media...');

      const token = getSessionToken();
      const resp = await fetch('/api/lessons/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await resp.json().catch(() => ({
        error: `Server returned ${resp.status}`,
      }));

      if (!resp.ok) {
        throw new Error(data.error || `Generation failed (${resp.status})`);
      }

      if (!data.lesson_id) {
        throw new Error('Invalid response from generation server');
      }

      setCurrentStepIndex(2);
      setStatusMessage('Redirecting to your lesson...');

      sessionStorage.removeItem('generationSession');

      // Clear stage store so the lesson loads fresh from server
      useStageStore.getState().clearStore();

      // Small delay so user sees "complete" state
      await new Promise((r) => setTimeout(r, 600));
      router.push(`/lessons/${data.lesson_id}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        log.info('[GenerationPreview] Generation aborted');
        return;
      }
      sessionStorage.removeItem('generationSession');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const goBackToClassroom = () => {
    sessionStorage.removeItem('generationSession');
    sessionStorage.removeItem('generationParams');
    useStageStore.getState().clearStore();
    router.replace('/classroom');
  };

  if (!sessionLoaded) {
    return (
      <div className="min-h-[100dvh] bg-neutral-950 flex items-center justify-center">
        <Loader2 className="size-6 text-neutral-500 animate-spin" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-[100dvh] bg-neutral-950 flex items-center justify-center p-4">
        <Card className="p-8 max-w-md w-full bg-neutral-900 border-neutral-800">
          <div className="text-center space-y-4">
            <AlertCircle className="size-12 text-neutral-500 mx-auto" />
            <h2 className="text-xl font-semibold text-neutral-100">
              {t('generation.sessionNotFound')}
            </h2>
            <p className="text-sm text-neutral-500">{t('generation.sessionNotFoundDesc')}</p>
            <Button onClick={goBackToClassroom} className="w-full">
              <ArrowLeft className="size-4 mr-2" />
              {t('generation.backToHome')}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const activeStep = STEPS[Math.min(currentStepIndex, STEPS.length - 1)];

  return (
    <div className="min-h-[100dvh] bg-neutral-950 flex flex-col">
      <header className="border-b border-neutral-800/60 px-6 py-4 flex items-center shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={goBackToClassroom}
          className="text-neutral-400 hover:text-white"
        >
          <ArrowLeft className="size-4 mr-2" />
          Back
        </Button>
        <div className="ml-4">
          <h1 className="text-sm font-medium text-neutral-200">Lesson Generation</h1>
          <p className="text-xs text-neutral-600">
            {activeStep ? activeStep.title : 'Preparing...'}
          </p>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg">
          {/* Progress bar */}
          <div className="mb-8">
            <div className="flex justify-between text-xs text-neutral-500 mb-2">
              <span>Overall Progress</span>
              <span className="text-neutral-400">
                {Math.min(currentStepIndex, STEPS.length)} of {STEPS.length} steps
              </span>
            </div>
            <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
              <motion.div
                className={cn(
                  'h-full rounded-full',
                  error ? 'bg-red-500' : 'bg-emerald-500'
                )}
                initial={{ width: 0 }}
                animate={{
                  width: `${STEPS.length > 0 ? (Math.min(currentStepIndex, STEPS.length) / STEPS.length) * 100 : 0}%`,
                }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>
          </div>

          {/* Steps list */}
          <div className="space-y-2">
            {STEPS.map((step, idx) => {
              const isCompleted = idx < currentStepIndex;
              const isActive = idx === currentStepIndex && !error;
              const isFailed = idx === currentStepIndex && !!error;
              const isPending = idx > currentStepIndex;

              return (
                <div
                  key={step.id}
                  className={cn(
                    'flex items-start gap-4 p-4 rounded-xl border transition-all duration-300',
                    isActive && 'bg-neutral-900/80 border-neutral-700/50',
                    isFailed && 'bg-red-950/10 border-red-900/30',
                    isCompleted && 'bg-transparent border-transparent opacity-70',
                    isPending && 'bg-transparent border-transparent opacity-40'
                  )}
                >
                  <div className="mt-0.5 shrink-0">
                    {isCompleted ? (
                      <CheckCircle2 className="size-5 text-emerald-500" />
                    ) : isFailed ? (
                      <XCircle className="size-5 text-red-500" />
                    ) : isActive ? (
                      <Loader2 className="size-5 text-blue-500 animate-spin" />
                    ) : (
                      <div className="size-5 rounded-full border-2 border-neutral-700" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3
                      className={cn(
                        'text-sm font-medium',
                        isCompleted && 'text-emerald-400 line-through',
                        isFailed && 'text-red-300',
                        isActive && 'text-white',
                        isPending && 'text-neutral-500'
                      )}
                    >
                      {step.title}
                    </h3>
                    <p
                      className={cn(
                        'text-xs mt-1 leading-relaxed',
                        isFailed && 'text-red-400',
                        isActive && 'text-neutral-400',
                        isCompleted && 'text-neutral-600',
                        isPending && 'text-neutral-700'
                      )}
                    >
                      {isFailed ? error : isActive ? statusMessage || step.description : step.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {error && (
            <div className="mt-6 flex gap-3">
              <Button
                onClick={goBackToClassroom}
                className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-white border border-neutral-700"
              >
                <ArrowLeft className="size-4 mr-2" />
                Go Back & Retry
              </Button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function GenerationPreviewPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[100dvh] bg-neutral-950 flex items-center justify-center">
          <Loader2 className="size-6 text-neutral-500 animate-spin" />
        </div>
      }
    >
      <GenerationPreviewContent />
    </Suspense>
  );
}
