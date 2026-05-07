'use client';

import { Stage } from '@/components/stage';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { SiteHeader } from '@/components/layout/site-header';
import { ClassroomSidebar } from '@/components/classroom/classroom-sidebar';
import { useStageStore } from '@/lib/store';
import { loadImageMapping } from '@/lib/utils/image-storage';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Download, Loader2, AlertCircle, ArrowUp, Sparkles, X } from 'lucide-react';
import { useSceneGenerator } from '@/lib/hooks/use-scene-generator';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useWhiteboardHistoryStore } from '@/lib/store/whiteboard-history';
import { createLogger } from '@/lib/logger';
import { MediaStageProvider } from '@/lib/contexts/media-stage-context';
import { generateMediaForOutlines } from '@/lib/media/media-orchestrator';
import { markShelfOpened } from '@/lib/lesson/shelf-client';
import { useI18n } from '@/lib/hooks/use-i18n';
import { hasAuthSessionHint, authHeaders } from '@/lib/auth/session';
import { useSettingsStore, type LearningMode } from '@/lib/store/settings';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { nanoid } from 'nanoid';
import { toast } from 'sonner';
import { GenerationToolbar } from '@/components/generation/generation-toolbar';
import { ModeSelector } from '@/components/generation/mode-selector';
import { SpeechButton } from '@/components/audio/speech-button';
import { LearningStyleDialog } from '@/components/lesson/learning-style-dialog';
import { cn } from '@/lib/utils';
import type { UserRequirements } from '@/lib/types/generation';

const log = createLogger('LessonStudio');

// ─── Studio bar height so Stage can account for it ───────────────────────────
const STUDIO_BAR_HEIGHT = 120; // px — approximate, keeps Stage from being clipped

export default function LessonStudioPage() {
  const params = useParams();
  const router = useRouter();
  const classroomId = params?.id as string;
  const { t } = useI18n();

  // ── Stage loading ──────────────────────────────────────────────────────────
  const { loadFromStorage } = useStageStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const generationStartedRef = useRef(false);
  const shelfOpenedRef = useRef(false);

  const { generateRemaining, retrySingleOutline, stop } = useSceneGenerator({
    onComplete: () => {
      log.info('[Studio] All scenes generated');
    },
  });

  // ── Studio input state ─────────────────────────────────────────────────────
  const [studioInput, setStudioInput] = useState('');
  const [studioLanguage, setStudioLanguage] = useState('en-US');
  const [studioWebSearch, setStudioWebSearch] = useState(true);
  const [studioPdfFile, setStudioPdfFile] = useState<File | null>(null);
  const [studioGenerating, setStudioGenerating] = useState(false);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [studioBarOpen, setStudioBarOpen] = useState(true);
  const studioTextareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Learning style dialog state ────────────────────────────────────────────
  const [lsDialog, setLsDialog] = useState<{
    open: boolean;
    pendingMode: LearningMode | null;
  }>({ open: false, pendingMode: null });

  const currentLearningMode = useSettingsStore((s) => s.learningMode);
  const setLearningMode = useSettingsStore((s) => s.setLearningMode);

  // ── Load classroom ─────────────────────────────────────────────────────────
  const loadClassroom = useCallback(async () => {
    try {
      await loadFromStorage(classroomId);

      if (!useStageStore.getState().stage) {
        log.info('No IndexedDB data, trying server-side storage for:', classroomId);
        try {
          const res = await fetch(`/api/lessons?id=${encodeURIComponent(classroomId)}`);
          if (res.ok) {
            const json = await res.json();
            if (json.success && json.classroom) {
              const { stage, scenes } = json.classroom;
              useStageStore.getState().setStage(stage);
              useStageStore.setState({
                scenes,
                currentSceneId: scenes[0]?.id ?? null,
              });
              log.info('Loaded from server-side storage:', classroomId);

              if (stage.generatedAgentConfigs?.length) {
                const { saveGeneratedAgents } = await import('@/lib/orchestration/registry/store');
                const { useSettingsStore: ss } = await import('@/lib/store/settings');
                const agentIds = await saveGeneratedAgents(stage.id, stage.generatedAgentConfigs);
                ss.getState().setSelectedAgentIds(agentIds);
              }
            }
          } else if (res.status === 404) {
            throw new Error('Lesson not found (404)');
          } else {
            throw new Error(`Server returned ${res.status}`);
          }
        } catch (fetchErr) {
          log.warn('Server-side storage fetch failed:', fetchErr);
          throw fetchErr;
        }
      }

      await useMediaGenerationStore.getState().restoreFromDB(classroomId);

      const { loadGeneratedAgentsForStage, useAgentRegistry } =
        await import('@/lib/orchestration/registry/store');
      const { useSettingsStore: ss } = await import('@/lib/store/settings');
      const generatedAgentIds = await loadGeneratedAgentsForStage(classroomId);
      if (generatedAgentIds.length > 0) {
        ss.getState().setAgentMode('auto');
        ss.getState().setSelectedAgentIds(generatedAgentIds);
      } else {
        const stage = useStageStore.getState().stage;
        const { useAgentRegistry: ar } = await import('@/lib/orchestration/registry/store');
        const registry = ar.getState();
        const cleanIds = stage?.agentIds?.filter((id) => {
          const a = registry.getAgent(id);
          return a && !a.isGenerated;
        });
        ss.getState().setAgentMode('preset');
        ss.getState().setSelectedAgentIds(cleanIds?.length ? cleanIds : ['default-1']);
      }

      // Pre-fill studio language from stage language
      const stageLanguage = useStageStore.getState().stage?.language;
      if (stageLanguage) setStudioLanguage(stageLanguage);
    } catch (err) {
      log.error('Failed to load lesson:', err);
      setError(err instanceof Error ? err.message : t('classroom.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [classroomId, loadFromStorage, t]);

  useEffect(() => {
    if (!hasAuthSessionHint()) {
      router.replace(`/auth?next=${encodeURIComponent(`/lessons/${classroomId}`)}`);
      return;
    }

    setLoading(true);
    setError(null);
    generationStartedRef.current = false;

    const mediaStore = useMediaGenerationStore.getState();
    mediaStore.revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });
    useWhiteboardHistoryStore.getState().clearHistory();

    loadClassroom();

    return () => { stop(); };
  }, [classroomId, loadClassroom, router, stop]);

  useEffect(() => {
    if (loading || error || shelfOpenedRef.current) return;
    shelfOpenedRef.current = true;
    markShelfOpened(classroomId).catch((err) => {
      log.warn('Failed to mark lesson shelf opened:', err);
    });
  }, [classroomId, loading, error]);

  // Auto-resume generation for pending outlines
  useEffect(() => {
    if (loading || error || generationStartedRef.current) return;
    const state = useStageStore.getState();
    const { outlines, scenes, stage } = state;
    const completedOrders = new Set(scenes.map((s) => s.order));
    const hasPending = outlines.some((o) => !completedOrders.has(o.order));

    if (hasPending && stage) {
      generationStartedRef.current = true;
      const genParamsStr = sessionStorage.getItem('generationParams');
      const genParams = genParamsStr ? JSON.parse(genParamsStr) : {};
      const storageIds = (genParams.pdfImages || [])
        .map((img: { storageId?: string }) => img.storageId)
        .filter(Boolean);

      loadImageMapping(storageIds).then((imageMapping) => {
        generateRemaining({
          pdfImages: genParams.pdfImages,
          imageMapping,
          stageInfo: {
            name: stage.name || '',
            description: stage.description,
            language: stage.language,
            style: stage.style,
          },
          agents: genParams.agents,
          userProfile: genParams.userProfile,
        });
      });
    } else if (outlines.length > 0 && stage) {
      generationStartedRef.current = true;
      generateMediaForOutlines(outlines, stage.id).catch((err) => {
        log.warn('[Studio] Media generation resume error:', err);
      });
    }
  }, [loading, error, generateRemaining]);

  // ── Export video ───────────────────────────────────────────────────────────
  const handleExportVideo = async () => {
    setExporting(true);
    try {
      const response = await fetch(`/api/lessons/${encodeURIComponent(classroomId)}/export/video`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`Export failed: ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `lesson-${classroomId}.mp4`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      log.error('Failed to export lesson video:', err);
      setError(t('classroom.exportVideoFailed'));
    } finally {
      setExporting(false);
    }
  };

  // ── Studio: generate a new lesson from the input bar ─────────────────────
  const handleStudioGenerate = useCallback(async () => {
    if (studioGenerating) return;

    const topic = studioInput.trim();
    if (!topic) {
      setStudioError('Please describe what you want to learn.');
      return;
    }

    setStudioError(null);
    setStudioGenerating(true);

    try {
      // Billing guard
      const billingRes = await fetch('/api/billing/dashboard', {
        method: 'GET',
        headers: authHeaders(),
        cache: 'no-store',
      });
      if (billingRes.ok) {
        const bd = await billingRes.json();
        const credits = bd.data?.entitlement?.credit_balance ?? 0;
        const hasSub = bd.data?.entitlement?.has_active_subscription ?? false;
        if (!hasSub && credits <= 0) {
          toast.error('Insufficient credits', { description: 'Please choose a plan.' });
          router.push('/pricing');
          return;
        }
      }

      const userProfile = useUserProfileStore.getState();
      const requirements: UserRequirements = {
        requirement: topic,
        language: studioLanguage,
        userNickname: userProfile.nickname || undefined,
        userBio: userProfile.bio || undefined,
        webSearch: studioWebSearch || undefined,
      };

      const sessionState = {
        sessionId: nanoid(),
        requirements,
        pdfText: '',
        pdfImages: [],
        imageStorageIds: [],
        pdfStorageKey: undefined,
        pdfFileName: undefined,
        pdfProviderId: undefined,
        pdfProviderConfig: undefined,
        sceneOutlines: null,
        currentStep: 'generating' as const,
      };

      sessionStorage.setItem('generationSession', JSON.stringify(sessionState));
      router.push('/generation-preview');
    } catch (err) {
      log.error('Studio generate failed:', err);
      setStudioError(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setStudioGenerating(false);
    }
  }, [studioGenerating, studioInput, studioLanguage, studioWebSearch, router]);

  // ── Learning style intercept ──────────────────────────────────────────────
  /**
   * Called by ModeSelector when the user picks a different learning style.
   * We show a confirmation dialog; if confirmed, set the new mode in the store
   * THEN launch a new lesson on the same topic.
   */
  const handleLearningModeChangeRequest = useCallback((mode: LearningMode) => {
    const stage = useStageStore.getState().stage;
    setLsDialog({ open: true, pendingMode: mode });
    // We'll use stage.name as the topic inside the dialog
  }, []);

  const handleLearningStyleConfirm = useCallback(async () => {
    if (!lsDialog.pendingMode) return;

    const stage = useStageStore.getState().stage;
    const topic = stage?.name?.trim() || studioInput.trim();

    if (!topic) {
      toast.error('Cannot determine lesson topic. Please type a topic in the studio bar.');
      setLsDialog({ open: false, pendingMode: null });
      return;
    }

    // 1. Commit the new learning mode to the store BEFORE starting generation
    setLearningMode(lsDialog.pendingMode);

    setLsDialog({ open: false, pendingMode: null });

    // 2. Build generation session with the current stage topic + new learning mode
    const userProfile = useUserProfileStore.getState();
    const requirements: UserRequirements = {
      requirement: topic,
      language: stage?.language || studioLanguage,
      userNickname: userProfile.nickname || undefined,
      userBio: userProfile.bio || undefined,
      webSearch: studioWebSearch || undefined,
    };

    // The generation-preview page reads learningMode from settingsStore (already updated above)
    const sessionState = {
      sessionId: nanoid(),
      requirements,
      pdfText: '',
      pdfImages: [],
      imageStorageIds: [],
      pdfStorageKey: undefined,
      pdfFileName: undefined,
      pdfProviderId: undefined,
      pdfProviderConfig: undefined,
      sceneOutlines: null,
      currentStep: 'generating' as const,
    };

    sessionStorage.setItem('generationSession', JSON.stringify(sessionState));
    router.push('/generation-preview');
  }, [lsDialog.pendingMode, studioLanguage, studioWebSearch, setLearningMode, router]);

  const handleLearningStyleCancel = useCallback(() => {
    setLsDialog({ open: false, pendingMode: null });
  }, []);

  // ── Current stage for dialog ───────────────────────────────────────────────
  const stageName = useStageStore((s) => s.stage?.name ?? '');
  const stageLanguage = useStageStore((s) => s.stage?.language ?? 'en-US');

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <ThemeProvider>
      {/* Learning style change dialog — rendered at root to overlay everything */}
      <LearningStyleDialog
        open={lsDialog.open}
        topic={stageName}
        currentMode={currentLearningMode}
        pendingMode={lsDialog.pendingMode ?? ''}
        onConfirm={handleLearningStyleConfirm}
        onCancel={handleLearningStyleCancel}
      />

      <div className="flex h-screen overflow-hidden bg-[#F8FAFC] dark:bg-neutral-900/50">
        <ClassroomSidebar currentStageId={classroomId} />

        <div className="flex-1 flex flex-col min-w-0 relative">
          <SiteHeader variant="dashboard" />

          <MediaStageProvider value={classroomId}>
            <div className="flex-1 flex flex-col overflow-hidden pt-16">

              {/* ── Export button ── */}
              {!loading && !error && (
                <div className="fixed right-6 bottom-[calc(var(--studio-bar-h,136px)+16px)] z-40 flex flex-col gap-2">
                  <button
                    onClick={handleExportVideo}
                    disabled={exporting}
                    className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/95 px-5 py-3 text-sm font-black shadow-xl backdrop-blur hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-all disabled:opacity-60 text-[#0F172A] dark:text-white uppercase tracking-tight flex items-center gap-2"
                  >
                    {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4 text-[#10B981]" />}
                    {exporting ? t('classroom.exportingVideo') : t('classroom.exportVideo')}
                  </button>
                </div>
              )}

              {/* ── Stage / error / loading ── */}
              {loading ? (
                <div className="flex-1 flex items-center justify-center bg-[#F8FAFC] dark:bg-neutral-900/50">
                  <div className="text-center">
                    <Loader2 className="size-10 animate-spin text-[#10B981] mx-auto mb-4 opacity-40" />
                    <p className="text-sm font-bold text-neutral-400 uppercase tracking-widest">{t('classroom.loading')}</p>
                  </div>
                </div>
              ) : error ? (
                <div className="flex-1 flex items-center justify-center bg-[#F8FAFC] dark:bg-neutral-900/50">
                  <div className="text-center max-w-sm px-6">
                    <div className="size-16 rounded-3xl bg-rose-50 text-rose-500 flex items-center justify-center mx-auto mb-6 border border-rose-100 shadow-sm">
                      <AlertCircle className="size-8" />
                    </div>
                    <h2 className="text-xl font-black text-[#0F172A] dark:text-white uppercase mb-2">Load Failed</h2>
                    <p className="text-sm text-neutral-500 mb-8">{error}</p>
                    <button
                      onClick={() => {
                        setError(null);
                        setLoading(true);
                        loadClassroom();
                      }}
                      className="w-full py-4 bg-[#0F172A] text-white rounded-2xl font-black uppercase tracking-widest hover:bg-black transition-all shadow-lg shadow-blue-900/20"
                    >
                      {t('classroom.retry')}
                    </button>
                  </div>
                </div>
              ) : (
                /* Stage consumes all remaining space above the studio bar */
                <div
                  className="flex-1 overflow-hidden"
                  style={{ paddingBottom: studioBarOpen ? STUDIO_BAR_HEIGHT : 40 }}
                >
                  <Stage onRetryOutline={retrySingleOutline} />
                </div>
              )}

              {/* ── Studio Input Bar ────────────────────────────────────────── */}
              <div
                className={cn(
                  'fixed bottom-0 left-0 right-0 z-30 transition-transform duration-300',
                  // Account for sidebar width — sidebar uses a fixed width; leave as-is,
                  // the sidebar itself is inside the flex layout so we use inset-x-0 and
                  // the sidebar renders above us in z-order. We rely on the sidebar's own
                  // z-index being lower than this (z-30).
                )}
                style={{ '--studio-bar-h': `${STUDIO_BAR_HEIGHT}px` } as React.CSSProperties}
              >
                <div className="mx-auto max-w-4xl px-4 pb-3">
                  {/* Pill bar */}
                  <div className="rounded-2xl border border-border/60 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl shadow-2xl shadow-black/10 dark:shadow-black/40">
                    {/* Header row */}
                    <div className="flex items-center px-4 pt-3 pb-1 gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <Sparkles className="size-3.5 text-primary shrink-0" />
                        <span className="text-[11px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-widest">
                          Studio
                        </span>
                        {stageName && (
                          <>
                            <span className="text-neutral-300 dark:text-neutral-700">·</span>
                            <span className="text-[11px] text-neutral-400 dark:text-neutral-500 truncate">
                              {stageName.length > 50 ? stageName.slice(0, 50) + '…' : stageName}
                            </span>
                          </>
                        )}
                      </div>
                      <button
                        onClick={() => setStudioBarOpen((v) => !v)}
                        className="p-1 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors shrink-0"
                        title={studioBarOpen ? 'Collapse studio' : 'Expand studio'}
                      >
                        <X className={cn('size-3.5 transition-transform', !studioBarOpen && 'rotate-45')} />
                      </button>
                    </div>

                    {/* Input row */}
                    {studioBarOpen && (
                      <>
                        <textarea
                          ref={studioTextareaRef}
                          rows={1}
                          placeholder="Ask a new lesson, rephrase, or explore a related topic…"
                          className="w-full resize-none border-0 bg-transparent px-4 pb-1 text-[13px] leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none min-h-[36px] max-h-[120px]"
                          value={studioInput}
                          onChange={(e) => setStudioInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleStudioGenerate();
                            }
                          }}
                        />

                        {/* Toolbar row */}
                        <div className="px-3 pb-3 flex items-center gap-2">
                          <div className="flex-1 min-w-0 flex items-center gap-2">
                            <GenerationToolbar
                              language={studioLanguage}
                              onLanguageChange={setStudioLanguage}
                              webSearch={studioWebSearch}
                              onWebSearchChange={setStudioWebSearch}
                              onSettingsOpen={() => {}}
                              pdfFile={studioPdfFile}
                              onPdfFileChange={setStudioPdfFile}
                              onPdfError={() => {}}
                            />
                            {/* Mode selector with learning style intercept */}
                            <ModeSelector
                              onLearningModeChange={handleLearningModeChangeRequest}
                            />
                          </div>

                          <SpeechButton
                            size="md"
                            onTranscription={(text) => {
                              setStudioInput((prev) => prev + (prev ? ' ' : '') + text);
                            }}
                          />

                          <button
                            onClick={handleStudioGenerate}
                            disabled={!studioInput.trim() || studioGenerating}
                            className={cn(
                              'shrink-0 h-8 w-8 rounded-lg flex items-center justify-center transition-all',
                              studioInput.trim() && !studioGenerating
                                ? 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm cursor-pointer'
                                : 'bg-muted text-muted-foreground/40 cursor-not-allowed',
                            )}
                          >
                            {studioGenerating ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <ArrowUp className="size-4" />
                            )}
                          </button>
                        </div>

                        {studioError && (
                          <p className="px-4 pb-2 text-xs text-red-500">{studioError}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </MediaStageProvider>
        </div>
      </div>
    </ThemeProvider>
  );
}
