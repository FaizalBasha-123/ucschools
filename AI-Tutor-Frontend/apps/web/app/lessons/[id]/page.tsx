'use client';

import { Stage } from '@/components/stage';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { useStageStore } from '@/lib/store';
import { loadImageMapping } from '@/lib/utils/image-storage';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Download, Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
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
import { LearningStyleDialog } from '@/components/lesson/learning-style-dialog';
import { StudioInputBar } from '@/components/lesson/studio-input-bar';
import { StudioSceneStrip } from '@/components/lesson/studio-scene-strip';
import { MaxScenesDialog } from '@/components/lesson/max-scenes-dialog';
import {
  SceneCheckinWidget,
  useSceneCheckin,
  type CheckinQuestion,
} from '@/components/lesson/scene-checkin-widget';
import { cn } from '@/lib/utils';
import type { UserRequirements } from '@/lib/types/generation';
import { motion } from 'motion/react';

const log = createLogger('LessonStudio');

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

  const shelfOpenedRef = useRef(false);

  // ── Studio input state ─────────────────────────────────────────────────────
  const [studioInput, setStudioInput] = useState('');
  const [studioLanguage, setStudioLanguage] = useState('en-US');
  const [studioPdfFile, setStudioPdfFile] = useState<File | null>(null);
  const [studioGenerating, setStudioGenerating] = useState(false);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [studioBarOpen, setStudioBarOpen] = useState(true);

  // ── Learning style dialog state ──
  const [lsDialog, setLsDialog] = useState<{
    open: boolean;
    pendingMode: LearningMode | null;
  }>({ open: false, pendingMode: null });

  // ── Max-scenes dialog state ────────────────────────────────────────────────
  const [maxScenesDialog, setMaxScenesDialog] = useState<{
    open: boolean;
    pendingInput: string;
    extraCost?: number;
  }>({ open: false, pendingInput: '' });

  // ── Scene check-in state ───────────────────────────────────────────────────
  const [checkin, setCheckin] = useState<{
    visible: boolean;
    sceneIndex: number;
    question: CheckinQuestion | null;
  }>({ visible: false, sceneIndex: 0, question: null });

  const scenes = useStageStore((s) => s.scenes);
  const currentSceneId = useStageStore((s) => s.currentSceneId);
  const currentSceneIndex = scenes.findIndex((sc) => sc.id === currentSceneId);

  const currentLearningMode = useSettingsStore((s) => s.learningMode);
  const setLearningMode = useSettingsStore((s) => s.setLearningMode);

  // ── Check-in trigger: fire every 2 scenes ─────────────────────────────────
  const { onSceneAdvance } = useSceneCheckin({
    onTrigger: async (sceneIdx) => {
      const stage = useStageStore.getState().stage;
      const scene = useStageStore.getState().scenes[sceneIdx];
      if (!stage || !scene) return;
      try {
        // Ask the chat AI to generate a quick comprehension question for this scene.
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            session_id: `checkin:${stage.id}:${sceneIdx}`,
            session_mode: 'qa',
            messages: [
              {
                id: nanoid(),
                role: 'user',
                content:
                  `Generate a single multiple-choice comprehension question for scene: "${scene.title}" ` +
                  `in lesson "${stage.name}". ` +
                  `Return JSON: {"id":"q1","text":"...","options":[{"label":"...","value":"A"},{...}],` +
                  `"correctAnswer":"A","explanation":"..."}. Return ONLY the JSON.`,
              },
            ],
          }),
        });
        if (!res.ok) return;
        // The chat route streams SSE events; collect the full text delta.
        const reader = res.body?.getReader();
        if (!reader) return;
        let full = '';
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          // Parse SSE data lines
          chunk.split('\n').forEach((line) => {
            if (line.startsWith('data: ')) {
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.kind === 'text_delta' && ev.content) full += ev.content;
              } catch { /* skip */ }
            }
          });
        }
        // Extract JSON from the full response
        const jsonMatch = full.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return;
        const q: CheckinQuestion = JSON.parse(jsonMatch[0]);
        setCheckin({ visible: true, sceneIndex: sceneIdx, question: q });
      } catch (err) {
        log.warn('[Checkin] Failed to generate check-in question:', err);
      }
    },
  });

  // Track scene navigation for check-in triggers
  useEffect(() => {
    if (currentSceneIndex >= 0) {
      onSceneAdvance(currentSceneIndex);
    }
  }, [currentSceneIndex, onSceneAdvance]);

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

      const { loadGeneratedAgentsForStage } = await import('@/lib/orchestration/registry/store');
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

    const mediaStore = useMediaGenerationStore.getState();
    mediaStore.revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });
    useWhiteboardHistoryStore.getState().clearHistory();

    loadClassroom();

    return () => { /* no-op */ };
  }, [classroomId, loadClassroom, router]);

  useEffect(() => {
    if (loading || error || shelfOpenedRef.current) return;
    shelfOpenedRef.current = true;
    markShelfOpened(classroomId).catch((err) => {
      log.warn('Failed to mark lesson shelf opened:', err);
    });
  }, [classroomId, loading, error]);

  // Trigger media generation for outlines if needed
  useEffect(() => {
    if (loading || error) return;
    const state = useStageStore.getState();
    const { outlines, stage } = state;
    if (outlines.length > 0 && stage) {
      generateMediaForOutlines(outlines, stage.id).catch((err) => {
        log.warn('[Studio] Media generation resume error:', err);
      });
    }
  }, [loading, error]);

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
      toast.error('Export failed', { description: 'Could not export lesson video.' });
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

    // ── Max-scenes gate ────────────────────────────────────────────────────
    const { stage: currentStage, scenes: currentScenes } = useStageStore.getState();
    const hardMax = currentStage?.max_scenes;
    if (hardMax != null && currentScenes.length >= hardMax) {
      // The user is asking for more content but the lesson is full.
      setMaxScenesDialog({ open: true, pendingInput: topic });
      return;
    }
    // ── End max-scenes gate ────────────────────────────────────────────────

    setStudioError(null);
    setStudioGenerating(true);

    try {
      const billingRes = await fetch('/api/billing/dashboard', {
        method: 'GET',
        headers: authHeaders(),
        cache: 'no-store',
      });

      // Hard block: if we can't verify entitlement, don't proceed.
      // The Rust backend will also reject it, but failing here gives better UX
      // and avoids burning compute on a doomed LLM call.
      if (!billingRes.ok) {
        if (billingRes.status === 401) {
          router.replace(`/auth?next=${encodeURIComponent(`/lessons/${classroomId}`)}`);
          return;
        }
        toast.error('Could not verify your credits', {
          description: 'Please check your connection and try again.',
        });
        return;
      }

      const bd = await billingRes.json();
      // apiSuccess() spreads data at root: { success, entitlement, ... }
      const entitlement = bd?.entitlement ?? bd?.data?.entitlement;
      const credits: number = entitlement?.credit_balance ?? 0;
      const hasSub: boolean = entitlement?.has_active_subscription ?? false;
      const canGenerate: boolean = entitlement?.can_generate ?? (credits > 0);
      if (!canGenerate && !hasSub && credits <= 0) {
        toast.error('Insufficient credits', { description: 'Please choose a plan.' });
        router.push('/pricing');
        return;
      }

      const userProfile = useUserProfileStore.getState();
      const requirements: UserRequirements = {
        requirement: topic,
        language: studioLanguage,
        userNickname: userProfile.nickname || undefined,
        userBio: userProfile.bio || undefined,
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
  }, [studioGenerating, studioInput, studioLanguage, classroomId, router]);

  // ── Learning style intercept ──────────────────────────────────────────────
  const handleLearningModeChangeRequest = useCallback((mode: LearningMode) => {
    setLsDialog({ open: true, pendingMode: mode });
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

    setLearningMode(lsDialog.pendingMode);
    setLsDialog({ open: false, pendingMode: null });

    const userProfile = useUserProfileStore.getState();
    const requirements: UserRequirements = {
      requirement: topic,
      language: stage?.language || studioLanguage,
      userNickname: userProfile.nickname || undefined,
      userBio: userProfile.bio || undefined,
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
  }, [lsDialog.pendingMode, studioLanguage, setLearningMode, router]);

  const handleLearningStyleCancel = useCallback(() => {
    setLsDialog({ open: false, pendingMode: null });
  }, []);

  // ── Max-scenes dialog handlers ──────────────────────────────────────────
  const handleMaxScenesConsent = useCallback(() => {
    setMaxScenesDialog((prev) => ({ ...prev, open: false }));
    // Re-trigger the studio generate flow with consent — the pendingInput becomes the topic.
    // We push to generation-preview with extra_scenes_consented=true via sessionStorage.
    const { stage } = useStageStore.getState();
    const userProfile = useUserProfileStore.getState();
    const topic = maxScenesDialog.pendingInput || stage?.name || '';
    const requirements: UserRequirements = {
      requirement: topic,
      language: stage?.language || studioLanguage,
      userNickname: userProfile.nickname || undefined,
      userBio: userProfile.bio || undefined,
    };
    sessionStorage.setItem(
      'generationSession',
      JSON.stringify({
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
        currentStep: 'generating',
        extraScenesConsented: true,
      }),
    );
    router.push('/generation-preview');
  }, [maxScenesDialog.pendingInput, studioLanguage, router]);

  const handleMaxScenesDecline = useCallback(() => {
    // Route the message to the chat bar instead.
    setMaxScenesDialog((prev) => ({ ...prev, open: false }));
    toast.info('Your question has been sent to the AI tutor.', { duration: 2500 });
    // The StudioInputBar value already contains the message; we clear it
    // so the user knows it was forwarded. (Chat is mounted via the Stage component.)
    setStudioInput('');
  }, []);

  // ── Checkin handlers ────────────────────────────────────────────────────
  const handleCheckinAnswer = useCallback(
    (_qId: string, _val: string, isCorrect: boolean) => {
      if (!isCorrect) {
        toast.info('The AI tutor will follow up on this in the chat.', { duration: 3000 });
      }
    },
    [],
  );

  const handleCheckinContinue = useCallback(() => {
    setCheckin((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleCheckinSkip = useCallback(() => {
    setCheckin((prev) => ({ ...prev, visible: false }));
  }, []);

  // ── Current scene metadata ─────────────────────────────────────────────────
  const stageName = useStageStore((s) => s.stage?.name ?? '');
  const { setCurrentSceneId } = useStageStore();

  // ── Studio bar height constant (for Stage padding) ─────────────────────────
  const STUDIO_BAR_HEIGHT = studioBarOpen ? 136 : 52;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <ThemeProvider>
      {/* Learning style change dialog */}
      <LearningStyleDialog
        open={lsDialog.open}
        topic={stageName}
        currentMode={currentLearningMode}
        pendingMode={lsDialog.pendingMode ?? ''}
        onConfirm={handleLearningStyleConfirm}
        onCancel={handleLearningStyleCancel}
      />

      {/* Max-scenes gate dialog */}
      <MaxScenesDialog
        open={maxScenesDialog.open}
        lessonName={stageName || maxScenesDialog.pendingInput}
        maxScenes={useStageStore.getState().stage?.max_scenes ?? 5}
        currentScenes={scenes.length}
        estimatedExtraCost={maxScenesDialog.extraCost}
        onConsent={handleMaxScenesConsent}
        onDecline={handleMaxScenesDecline}
        onClose={() => setMaxScenesDialog((p) => ({ ...p, open: false }))}
      />

      {/* Scene check-in widget (every 2 scenes) */}
      {checkin.visible && checkin.question && (
        <SceneCheckinWidget
          sceneNumber={checkin.sceneIndex + 1}
          lessonName={stageName}
          question={checkin.question}
          onAnswer={handleCheckinAnswer}
          onContinue={handleCheckinContinue}
          onSkip={handleCheckinSkip}
        />
      )}

      {/* Root layout: scene strip | main content */}
      <div className="flex h-screen overflow-hidden bg-[#F0F4F8] dark:bg-[#0D1117]">

        {/* ── Left: Vertical scene filmstrip (desktop) ───────────────────── */}
        <div className="hidden md:flex flex-col border-r border-border/50 bg-white/60 dark:bg-neutral-900/60 backdrop-blur-sm">
          {/* Back to classroom */}
          <button
            onClick={() => router.push('/classroom')}
            className="flex items-center justify-center h-14 shrink-0 border-b border-border/50 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
            title="Back to Classroom"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          {loading ? (
            <div className="flex-1 flex items-center justify-center w-[72px]">
              <Loader2 className="w-4 h-4 animate-spin text-neutral-300" />
            </div>
          ) : (
            <StudioSceneStrip
              onSceneSelect={setCurrentSceneId}
              orientation="vertical"
              className="flex-1"
            />
          )}

          {/* Export button at bottom of strip */}
          {!loading && !error && (
            <div className="p-2 border-t border-border/50">
              <button
                onClick={handleExportVideo}
                disabled={exporting}
                title="Export as video"
                className={cn(
                  'w-full flex flex-col items-center justify-center gap-1 py-2 rounded-xl text-[9px] font-bold uppercase tracking-wide transition-all',
                  exporting
                    ? 'text-neutral-300 dark:text-neutral-600'
                    : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-emerald-600',
                )}
              >
                {exporting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span>Export</span>
              </button>
            </div>
          )}
        </div>

        {/* ── Right: Main content area ───────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 relative">

          {/* Mobile: horizontal scene strip at top */}
          {!loading && !error && (
            <div className="md:hidden border-b border-border/50 bg-white/60 dark:bg-neutral-900/60">
              <StudioSceneStrip
                onSceneSelect={setCurrentSceneId}
                orientation="horizontal"
              />
            </div>
          )}

          <MediaStageProvider value={classroomId}>
            <div className="flex-1 flex flex-col overflow-hidden">

              {/* ── Stage / error / loading ── */}
              {loading ? (
                <div className="flex-1 flex items-center justify-center">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center gap-5"
                  >
                    <div className="relative">
                      <div className="absolute inset-0 bg-emerald-500/20 rounded-full animate-ping" />
                      <div className="relative h-14 w-14 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-sm flex items-center justify-center">
                        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-neutral-400 uppercase tracking-widest">
                      Loading lesson…
                    </p>
                  </motion.div>
                </div>
              ) : error ? (
                <div className="flex-1 flex items-center justify-center">
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center max-w-sm px-6"
                  >
                    <div className="h-16 w-16 rounded-3xl bg-rose-50 dark:bg-rose-900/20 text-rose-500 flex items-center justify-center mx-auto mb-6 border border-rose-100 dark:border-rose-700/30 shadow-sm">
                      <AlertCircle className="w-8 h-8" />
                    </div>
                    <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">
                      Lesson Unavailable
                    </h2>
                    <p className="text-sm text-neutral-500 mb-8">{error}</p>
                    <button
                      onClick={() => {
                        setError(null);
                        setLoading(true);
                        loadClassroom();
                      }}
                      className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-2xl font-bold hover:opacity-90 transition-opacity shadow-lg shadow-emerald-500/20"
                    >
                      Try Again
                    </button>
                    <button
                      onClick={() => router.push('/classroom')}
                      className="mt-3 w-full py-3.5 bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 rounded-2xl font-bold hover:opacity-90 transition-opacity"
                    >
                      Back to Classroom
                    </button>
                  </motion.div>
                </div>
              ) : (
                /* Stage — full width, ChatArea hidden (still mounted for SSE wiring) */
                <div
                  className="flex-1 overflow-hidden"
                  style={{ paddingBottom: STUDIO_BAR_HEIGHT }}
                >
                  <Stage />
                </div>
              )}

              {/* ── Studio Input Bar ─────────────────────────────────────── */}
              {!error && (
                <div className="fixed bottom-0 left-0 right-0 z-30 md:left-[88px]">
                  <div className="mx-auto max-w-3xl px-4 pb-4">
                    <StudioInputBar
                      value={studioInput}
                      onChange={setStudioInput}
                      onSubmit={handleStudioGenerate}
                      isSubmitting={studioGenerating}
                      error={studioError}
                      stageName={stageName}
                      language={studioLanguage}
                      onLanguageChange={setStudioLanguage}
                      pdfFile={studioPdfFile}
                      onPdfFileChange={setStudioPdfFile}
                      onLearningModeChange={handleLearningModeChangeRequest}
                      isOpen={studioBarOpen}
                      onToggle={() => setStudioBarOpen((v) => !v)}
                    />
                  </div>
                </div>
              )}
            </div>
          </MediaStageProvider>
        </div>
      </div>
    </ThemeProvider>
  );
}
