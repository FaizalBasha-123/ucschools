'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Clock,
  CreditCard,
  Copy,
  ImagePlus,
  Pencil,
  Trash2,
  Settings,
  Sun,
  Moon,
  Monitor,
  ChevronUp,
  BotOff,
  Loader2,
} from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { LanguageSwitcher } from '@/components/language-switcher';
import { createLogger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { Textarea as UITextarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { SettingsDialog } from '@/components/settings';
import { SiteHeader } from '@/components/layout/site-header';
import { GenerationToolbar } from '@/components/generation/generation-toolbar';
import { AgentBar } from '@/components/agent/agent-bar';
import { MissionSection } from '@/components/landing/mission-section';
import { UseCasesSection } from '@/components/landing/use-cases-section';
import { FinalCTA } from '@/components/landing/final-cta';
import { useTheme } from '@/lib/hooks/use-theme';
import { nanoid } from 'nanoid';
import { storePdfBlob } from '@/lib/utils/image-storage';
import type { UserRequirements } from '@/lib/types/generation';
import {
  archiveShelfItem,
  fetchShelf,
  markShelfOpened,
  reopenShelfItem,
  retryShelfItem,
  renameShelfItem,
  type LessonShelfItem,
} from '@/lib/lesson/shelf-client';
import { useUserProfileStore, AVATAR_OPTIONS } from '@/lib/store/user-profile';
import {
  StageListItem,
  listStages,
  deleteStageData,
  renameStage,
  getFirstSlideByStages,
} from '@/lib/utils/stage-storage';
import { ThumbnailSlide } from '@/components/slide-renderer/components/ThumbnailSlide';
import type { Slide } from '@/lib/types/slides';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useSettingsStore } from '@/lib/store/settings';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDraftCache } from '@/lib/hooks/use-draft-cache';
import { SpeechButton } from '@/components/audio/speech-button';
import { AuroraEffect } from '@/components/aurora-effect';
import { authHeaders, clearAuthSession, getAuthSession, hasAuthSessionHint, verifyAuthSession } from '@/lib/auth/session';
import { GoogleOneTap } from '@/components/auth/google-one-tap';

const log = createLogger('Home');

const WEB_SEARCH_STORAGE_KEY = 'webSearchEnabled';
const LANGUAGE_STORAGE_KEY = 'generationLanguage';
const RECENT_OPEN_STORAGE_KEY = 'recentClassroomsOpen';
const LESSON_SHELF_OPEN_STORAGE_KEY = 'lessonShelfOpen';

type LessonShelfFilter = 'all' | 'in-progress' | 'completed' | 'archived';

interface FormState {
  pdfFile: File | null;
  requirement: string;
  language: string;
  webSearch: boolean;
}

const initialFormState: FormState = {
  pdfFile: null,
  requirement: '',
  language: 'en-US',
  webSearch: true,
};

function HomePage() {
  const { t, locale } = useI18n();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialFormState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    import('@/lib/types/settings').SettingsSection | undefined
  >(undefined);

  // Draft cache for requirement text
  const { cachedValue: cachedRequirement, updateCache: updateRequirementCache } =
    useDraftCache<string>({ key: 'requirementDraft' });

  const [recentOpen, setRecentOpen] = useState(true);

  // Hydrate client-only state after mount (avoids SSR mismatch)
   
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_OPEN_STORAGE_KEY);
      if (saved !== null) setRecentOpen(saved !== 'false');
    } catch {
      /* localStorage unavailable */
    }
    try {
      const saved = localStorage.getItem(LESSON_SHELF_OPEN_STORAGE_KEY);
      if (saved !== null) setLessonShelfOpen(saved !== 'false');
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  // Sync header locale → form generation language
  // When the user switches language in the header (TA ↔ EN),
  // the lesson generation language updates automatically.
  useEffect(() => {
    setForm((prev) => ({ ...prev, language: locale }));
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
    } catch { /* ignore */ }
  }, [locale]);

  useEffect(() => {
    try {
      const savedWebSearch = localStorage.getItem(WEB_SEARCH_STORAGE_KEY);
      if (savedWebSearch === 'false') {
        setForm((prev) => ({ ...prev, webSearch: false }));
      }
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  // Restore requirement draft from cache (derived state pattern — no effect needed)
  const [prevCachedRequirement, setPrevCachedRequirement] = useState(cachedRequirement);
  if (cachedRequirement !== prevCachedRequirement) {
    setPrevCachedRequirement(cachedRequirement);
    if (cachedRequirement) {
      setForm((prev) => ({ ...prev, requirement: cachedRequirement }));
    }
  }

  // Removed legacy header states
  const [error, setError] = useState<string | null>(null);
  const [classrooms, setClassrooms] = useState<StageListItem[]>([]);
  const [lessonShelf, setLessonShelf] = useState<LessonShelfItem[]>([]);
  const [lessonShelfOpen, setLessonShelfOpen] = useState(true);
  const [lessonShelfLoading, setLessonShelfLoading] = useState(false);
  const [lessonShelfFilter, setLessonShelfFilter] = useState<LessonShelfFilter>('all');
  const [thumbnails, setThumbnails] = useState<Record<string, Slide>>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingShelfAction, setPendingShelfAction] = useState<string | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Auto-resize textarea logic ──
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [form.requirement]);

  const loadClassrooms = async () => {
    try {
      const list = await listStages();
      setClassrooms(list);
      // Load first slide thumbnails
      if (list.length > 0) {
        const slides = await getFirstSlideByStages(list.map((c) => c.id));
        setThumbnails(slides);
      }
    } catch (err) {
      log.error('Failed to load classrooms:', err);
    }
  };

  const loadLessonShelf = async () => {
    setLessonShelfLoading(true);
    try {
      const response = await fetchShelf();
      setLessonShelf(response.items);
    } catch (err) {
      setLessonShelf([]);
      log.warn('Lesson shelf unavailable for current session:', err);
    } finally {
      setLessonShelfLoading(false);
    }
  };

  useEffect(() => {
    // Clear stale media store to prevent cross-course thumbnail contamination.
    // The store may hold tasks from a previously visited classroom whose elementIds
    // (gen_img_1, etc.) collide with other courses' placeholders.
    useMediaGenerationStore.getState().revokeObjectUrls();
    loadClassrooms();

    // Auto-focus the generator input when the landing page loads
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
  }, []);

  useEffect(() => {
    if (authChecking) return;
    if (!isAuthenticated) {
      setLessonShelf([]);
      return;
    }
    loadLessonShelf();
  }, [authChecking, isAuthenticated]);

  useEffect(() => {
    const hydrateAuth = async () => {
      const hasSession = hasAuthSessionHint();
      if (!hasSession) {
        setIsAuthenticated(false);
        setAccountEmail(null);
        setAuthChecking(false);
        return;
      }

      const session = getAuthSession();

      try {
        // Parallelize session verification and classroom loading.
        // If the session is confirmed valid, redirect to /classroom immediately
        // so logged-in users skip the landing page.
        const [ok] = await Promise.all([
          verifyAuthSession(),
          loadClassrooms(),
        ]);

        if (ok) {
          // Valid session — send to classroom hub
          router.replace('/classroom');
          return;
        }
        // Session hint exists but verify failed (e.g. network issue) — stay on page
        setIsAuthenticated(true);
        setAccountEmail(session?.email || null);
      } catch (err) {
        log.error('Hydration failed:', err);
        setIsAuthenticated(true); // Fallback to local session
      } finally {
        setAuthChecking(false);
      }
    };

    hydrateAuth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistLessonShelfOpen = (next: boolean) => {
    setLessonShelfOpen(next);
    try {
      localStorage.setItem(LESSON_SHELF_OPEN_STORAGE_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  const visibleLessonShelf = lessonShelf.filter((item) => {
    switch (lessonShelfFilter) {
      case 'in-progress':
        return item.status === 'generating' || (item.status === 'ready' && item.progress_pct < 100);
      case 'completed':
        return item.status === 'ready' && item.progress_pct >= 100;
      case 'archived':
        return item.status === 'archived';
      case 'all':
      default:
        return true;
    }
  });

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDeleteId(id);
  };

  const confirmDelete = async (id: string) => {
    setPendingDeleteId(null);
    try {
      await deleteStageData(id);
      await loadClassrooms();
    } catch (err) {
      log.error('Failed to delete classroom:', err);
      toast.error('Failed to delete classroom');
    }
  };

  const handleRename = async (id: string, newName: string) => {
    try {
      await renameStage(id, newName);
      setClassrooms((prev) => prev.map((c) => (c.id === id ? { ...c, name: newName } : c)));
    } catch (err) {
      log.error('Failed to rename classroom:', err);
      toast.error(t('classroom.renameFailed'));
    }
  };

  const handleOpenShelfItem = async (item: LessonShelfItem) => {
    try {
      if (item.status !== 'archived') {
        await markShelfOpened(item.lesson_id, item.id);
      }
    } catch (err) {
      log.warn('Failed to mark lesson shelf item opened:', err);
    }
    router.push(`/lessons/${item.lesson_id}`);
  };

  const handleRenameShelfItem = async (item: LessonShelfItem) => {
    const nextName = window.prompt(t('classroom.shelf.renamePrompt'), item.title)?.trim();
    if (!nextName || nextName === item.title) return;
    setPendingShelfAction(item.id);
    try {
      await renameShelfItem(item.id, nextName);
      await loadLessonShelf();
    } catch (err) {
      log.error('Failed to rename lesson shelf item:', err);
      toast.error(t('classroom.shelf.renameFailed'));
    } finally {
      setPendingShelfAction(null);
    }
  };

  const handleArchiveShelfItem = async (item: LessonShelfItem) => {
    setPendingShelfAction(item.id);
    try {
      await archiveShelfItem(item.id);
      await loadLessonShelf();
    } catch (err) {
      log.error('Failed to archive lesson shelf item:', err);
      toast.error(t('classroom.shelf.archiveFailed'));
    } finally {
      setPendingShelfAction(null);
    }
  };

  const handleReopenShelfItem = async (item: LessonShelfItem) => {
    setPendingShelfAction(item.id);
    try {
      await reopenShelfItem(item.id);
      await loadLessonShelf();
    } catch (err) {
      log.error('Failed to reopen lesson shelf item:', err);
      toast.error(t('classroom.shelf.reopenFailed'));
    } finally {
      setPendingShelfAction(null);
    }
  };

  const handleRetryShelfItem = async (item: LessonShelfItem) => {
    setPendingShelfAction(item.id);
    try {
      await retryShelfItem(item.id);
      await loadLessonShelf();
    } catch (err) {
      log.error('Failed to retry lesson shelf item:', err);
      toast.error(t('classroom.shelf.retryFailed'));
    } finally {
      setPendingShelfAction(null);
    }
  };

  const updateForm = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    try {
      if (field === 'webSearch') localStorage.setItem(WEB_SEARCH_STORAGE_KEY, String(value));
      if (field === 'language') localStorage.setItem(LANGUAGE_STORAGE_KEY, String(value));
      if (field === 'requirement') updateRequirementCache(value as string);
    } catch {
      /* ignore */
    }
  };

  const showSetupToast = (icon: React.ReactNode, title: string, desc: string) => {
    toast.custom(
      (id) => (
        <div
          className="w-[356px] rounded-xl border border-teal-200/60 dark:border-teal-800/40 bg-gradient-to-r from-teal-50 via-white to-teal-50 dark:from-teal-950/60 dark:via-neutral-900 dark:to-teal-950/60 shadow-lg shadow-teal-500/8 dark:shadow-teal-900/20 p-4 flex items-start gap-3 cursor-pointer"
          onClick={() => {
            toast.dismiss(id);
            setSettingsOpen(true);
          }}
        >
          <div className="shrink-0 mt-0.5 size-9 rounded-lg bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center ring-1 ring-teal-200/50 dark:ring-teal-800/30">
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-teal-900 dark:text-teal-200 leading-tight">
              {title}
            </p>
            <p className="text-xs text-teal-700/80 dark:text-teal-400/70 mt-0.5 leading-relaxed">
              {desc}
            </p>
          </div>
          <div className="shrink-0 mt-1 text-[10px] font-medium text-teal-500 dark:text-teal-500/70 tracking-wide">
            <Settings className="size-3.5 animate-[spin_3s_linear_infinite]" />
          </div>
        </div>
      ),
      { duration: 4000 },
    );
  };

  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    if (authChecking || isGenerating) return;

    if (!isAuthenticated) {
      // Persist the user's lesson intent so the classroom can pre-fill it
      // after they sign in and complete billing.
      if (form.requirement.trim()) {
        try {
          localStorage.setItem(
            'pendingLesson',
            JSON.stringify({
              requirement: form.requirement.trim(),
              language: form.language,
              webSearch: form.webSearch,
            }),
          );
        } catch {
          // quota errors — proceed without persistence
        }
      }
      // Send them to sign-in; after login → check-billing → /classroom
      sessionStorage.setItem('postLoginNext', '/classroom');
      router.push('/auth?mode=signin&next=/classroom');
      return;
    }

    const verified = await verifyAuthSession();
    if (!verified) {
      clearAuthSession();
      setIsAuthenticated(false);
      setAccountEmail(null);
      // Save intent before sending them to auth
      if (form.requirement.trim()) {
        try {
          localStorage.setItem(
            'pendingLesson',
            JSON.stringify({
              requirement: form.requirement.trim(),
              language: form.language,
              webSearch: form.webSearch,
            }),
          );
        } catch { /* ignore */ }
      }
      sessionStorage.setItem('postLoginNext', '/classroom');
      router.push('/auth?mode=signin&next=/classroom');
      return;
    }

    if (!form.requirement.trim()) {
      setError(t('upload.requirementRequired'));
      return;
    }

    // Language selection is mandatory for deterministic generation behavior.
    if (!form.language) {
      setError(t('toolbar.languageHint'));
      return;
    }

    setError(null);
    setIsGenerating(true);

    try {
      // 1. First Check Billing Status
      const billingRes = await fetch('/api/billing/dashboard', {
        method: 'GET',
        headers: authHeaders(),
        cache: 'no-store',
      });

      if (billingRes.ok) {
        const billingData = await billingRes.json();
        // apiSuccess() spreads data at root: { success, entitlement, ... }
        // Fallback to .data.entitlement for any future structural changes.
        const entitlement = billingData?.entitlement ?? billingData?.data?.entitlement;
        const creditBalance: number = entitlement?.credit_balance ?? 0;
        const hasActiveSubscription: boolean = entitlement?.has_active_subscription ?? false;
        const canGenerate: boolean = entitlement?.can_generate ?? (creditBalance > 0);

        if (!canGenerate && !hasActiveSubscription && creditBalance <= 0) {
          toast.error('Insufficient credits', { description: 'Please choose a plan to generate lessons.' });
          router.push('/pricing');
          return;
        }
      }

      // 2. Proceed with generation preparation if billing is okay
      const userProfile = useUserProfileStore.getState();
      const requirements: UserRequirements = {
        requirement: form.requirement,
        language: form.language,
        userNickname: userProfile.nickname || undefined,
        userBio: userProfile.bio || undefined,
        webSearch: form.webSearch || undefined,
      };

      const settings = useSettingsStore.getState();

      let pdfStorageKey: string | undefined;
      let pdfFileName: string | undefined;
      let pdfProviderId: string | undefined;
      let pdfProviderConfig: { apiKey?: string; baseUrl?: string } | undefined;

      if (form.pdfFile) {
        pdfStorageKey = await storePdfBlob(form.pdfFile);
        pdfFileName = form.pdfFile.name;

        pdfProviderId = settings.pdfProviderId;
        const providerCfg = settings.pdfProvidersConfig?.[settings.pdfProviderId];
        if (providerCfg) {
          pdfProviderConfig = {
            apiKey: providerCfg.apiKey,
            baseUrl: providerCfg.baseUrl,
          };
        }
      }

      const sessionState = {
        sessionId: nanoid(),
        requirements,
        pdfText: '',
        pdfImages: [],
        imageStorageIds: [],
        pdfStorageKey,
        pdfFileName,
        pdfProviderId,
        pdfProviderConfig,
        sceneOutlines: null,
        currentStep: 'generating' as const,
        // Snapshot quality/learning mode at generation start for credit deduction
        qualityMode: settings.qualityMode || 'standard',
        learningMode: settings.learningMode || 'explain',
      };
      sessionStorage.setItem('generationSession', JSON.stringify(sessionState));

      router.push('/generation-preview');
    } catch (err) {
      log.error('Error preparing generation:', err);
      setError(err instanceof Error ? err.message : t('upload.generateFailed'));
    } finally {
      setIsGenerating(false);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return t('classroom.today');
    if (diffDays === 1) return t('classroom.yesterday');
    if (diffDays < 7) return `${diffDays} ${t('classroom.daysAgo')}`;
    return date.toLocaleDateString();
  };

  const canGenerate = !!form.requirement.trim();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canGenerate && !isGenerating) handleGenerate();
    } else if ((e.key === 'Tab' && e.shiftKey) || (e.key === 'Enter' && e.shiftKey)) {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      
      const newValue = value.substring(0, start) + '\n' + value.substring(end);
      updateForm('requirement', newValue);
      
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 1;
        }
      }, 0);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center p-4 pt-20 md:p-8 md:pt-24 overflow-x-hidden selection:bg-emerald-500/30 bg-background transition-colors duration-300" 
         style={{ 
           backgroundImage: 'radial-gradient(circle at 50% -20%, rgba(16,185,129,0.1) 0%, transparent 80%)'
         }}>
      {/* ═══ Top Navigation Header ═══ */}
      <SiteHeader variant="landing" />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) setSettingsSection(undefined);
        }}
        initialSection={settingsSection}
      />

      {/* ═══ Google One Tap — show only for unauthenticated visitors ═══ */}
      {!authChecking && !isAuthenticated && (
        <GoogleOneTap
          onSuccess={(session) => {
            setIsAuthenticated(true);
            setAccountEmail(session.email);
            loadLessonShelf();
          }}
          onError={(err) => {
            log.error('Google One Tap failed:', err);
          }}
        />
      )}

      {/* ═══ Aurora Effect — Top Edge ═══ */}
      <AuroraEffect className="fixed top-0 left-0 w-full h-64 md:h-80" />

      {/* ═══ Background Decor ═══ */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Animated Primary Mesh */}
        <motion.div
          animate={{ 
            scale: [1, 1.1, 1],
            opacity: [0.05, 0.08, 0.05] 
          }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[1000px] h-[600px] rounded-full blur-[140px]"
          style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.4) 0%, transparent 70%)' }}
        />
        
        {/* Accent Orbs */}
        <div
          className="absolute top-[10%] left-[5%] w-96 h-96 rounded-full blur-[100px] opacity-[0.02] dark:opacity-[0.03]"
          style={{ background: 'rgb(16,185,129)' }}
        />
        <div
          className="absolute top-[5%] right-[5%] w-80 h-80 rounded-full blur-[100px] opacity-[0.03] dark:opacity-[0.04]"
          style={{ background: 'rgb(99,102,241)' }}
        />

        {/* Dynamic Grid */}
        <div
          className="absolute inset-0 opacity-[0.02] dark:opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)`,
            backgroundSize: '64px 64px',
            maskImage: 'radial-gradient(ellipse 80% 50% at 50% 0%, black, transparent)',
            WebkitMaskImage: 'radial-gradient(ellipse 80% 50% at 50% 0%, black, transparent)'
          }}
        />
        
        {/* Subtle noise texture */}
        <div className="absolute inset-0 opacity-[0.015] pointer-events-none contrast-150 brightness-100" style={{ backgroundImage: 'url("https://grainy-gradients.vercel.app/noise.svg")' }} />

        {/* Transition fade */}
        <div className="absolute bottom-0 left-0 right-0 h-[40vh] bg-gradient-to-t from-background to-transparent" />
      </div>

      {/* ═══ Hero section ═══ */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          'relative z-20 w-full max-w-[850px] flex flex-col items-center',
          classrooms.length === 0 ? 'justify-center min-h-[calc(100dvh-12rem)] mb-12' : 'mt-[8vh] mb-16',
        )}
      >
        {/* ── Hero Headline ── */}
        <div className="text-center mb-10 w-full px-4">
          {/* Eyebrow */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="inline-flex items-center gap-2 mb-8 px-4 py-1.5 rounded-full border border-primary/20 bg-primary/5 backdrop-blur-md"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <span className="text-primary/90 dark:text-emerald-400/90 text-[10px] font-bold tracking-[0.2em] uppercase">
              Next-Gen Pedagogy Engine
            </span>
          </motion.div>

          {/* Main title */}
          <h1
            className="text-5xl sm:text-6xl md:text-7xl font-black leading-[1.05] tracking-tight mb-6 text-foreground"
          >
            Your curiosity,
            <br />
            <span
              className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500 dark:from-emerald-400 dark:via-teal-300 dark:to-emerald-400 animate-gradient-x"
              style={{ backgroundSize: '200% auto' }}
            >
              mastered instantly.
            </span>
          </h1>

          {/* Subheadline */}
          <p className="text-base md:text-lg text-muted-foreground/60 dark:text-white/50 max-w-xl mx-auto leading-relaxed font-medium">
            AI-Tutor crafts immersive, personalized classrooms from any description. 
            Stop searching for answers—start experiencing them.
          </p>
        </div>

        {/* ── Unified input area ── */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="w-full px-4 group"
        >
          <div className="w-full rounded-3xl border border-black/5 dark:border-white/10 bg-white/40 dark:bg-black/20 backdrop-blur-md md:backdrop-blur-xl lg:backdrop-blur-3xl shadow-xl dark:shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] transition-all duration-500 focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary/40" 
               style={{ 
                 background: 'var(--card)'
               }}>
            {/* Header part of input */}
            <div className="relative z-20 flex items-start justify-between">
              <GreetingBar />
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              placeholder="What do you want to understand deeply today?"
              className="w-full resize-none border-0 bg-transparent px-6 pt-2 pb-3 text-[14px] sm:text-[15px] md:text-[17px] leading-relaxed text-foreground placeholder:text-muted-foreground/40 focus:outline-none min-h-[56px] max-h-[180px] overflow-y-auto scrollbar-hide font-medium transition-[height] duration-200 ease-out"
              value={form.requirement}
              onChange={(e) => updateForm('requirement', e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />

            {/* Toolbar row */}
            <div className="px-4 pb-4 flex items-end gap-3">
              <div className="flex-1 min-w-0">
                <div className="bg-muted/50 dark:bg-white/5 rounded-2xl p-1 border border-border/50 dark:border-white/5">
                  <GenerationToolbar
                    language={form.language}
                    onLanguageChange={(lang) => updateForm('language', lang)}
                    webSearch={form.webSearch}
                    onWebSearchChange={(v) => updateForm('webSearch', v)}
                    onSettingsOpen={(section) => {
                      setSettingsSection(section);
                      setSettingsOpen(true);
                    }}
                    pdfFile={form.pdfFile}
                    onPdfFileChange={(f) => updateForm('pdfFile', f)}
                    onPdfError={setError}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <SpeechButton
                  size="md"
                  onTranscription={(text) => {
                    setForm((prev) => {
                      const next = prev.requirement + (prev.requirement ? ' ' : '') + text;
                      updateRequirementCache(next);
                      return { ...prev, requirement: next };
                    });
                  }}
                />

                <button
                  onClick={handleGenerate}
                  disabled={!canGenerate || authChecking || isGenerating}
                  className={cn(
                    'shrink-0 h-11 w-11 rounded-2xl flex items-center justify-center transition-all duration-300',
                    canGenerate && !authChecking && !isGenerating
                      ? 'bg-primary text-primary-foreground hover:opacity-90 shadow-lg active:scale-95 cursor-pointer'
                      : 'bg-muted text-muted-foreground/30 cursor-not-allowed',
                  )}
                >
                  {isGenerating ? <Loader2 className="size-5 animate-spin" /> : <ArrowUp className="size-5 stroke-[2.5]" />}
                </button>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Error ── */}
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

      {/* ═══ Lesson shelf ═══ */}
      {isAuthenticated && (lessonShelfLoading || lessonShelf.length > 0) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.42 }}
          className="relative z-10 mt-8 w-full max-w-6xl flex flex-col items-center"
        >
          <button
            onClick={() => persistLessonShelfOpen(!lessonShelfOpen)}
            className="group w-full flex items-center gap-4 py-2 cursor-pointer"
          >
            <div className="flex-1 h-px bg-border/40 group-hover:bg-border/70 transition-colors" />
            <span className="shrink-0 flex items-center gap-2 text-[13px] text-muted-foreground/60 group-hover:text-foreground/70 transition-colors select-none">
              <Check className="size-3.5" />
              {t('classroom.shelf.title')}
              <span className="text-[11px] tabular-nums opacity-60">{lessonShelf.length}</span>
              <motion.div
                animate={{ rotate: lessonShelfOpen ? 180 : 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
              >
                <ChevronUp className="size-3.5" />
              </motion.div>
            </span>
            <div className="flex-1 h-px bg-border/40 group-hover:bg-border/70 transition-colors" />
          </button>

          {lessonShelfOpen && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {(['all', 'in-progress', 'completed', 'archived'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setLessonShelfFilter(filter)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs font-medium transition-colors border',
                    lessonShelfFilter === filter
                      ? 'bg-foreground text-background border-foreground'
                      : 'bg-background/80 text-muted-foreground border-border/60 hover:bg-muted/60',
                  )}
                >
                  {filter === 'in-progress'
                    ? t('classroom.shelf.filterInProgress')
                    : filter === 'all'
                      ? t('classroom.shelf.filterAll')
                      : filter === 'completed'
                        ? t('classroom.shelf.filterCompleted')
                        : t('classroom.shelf.filterArchived')}
                </button>
              ))}
            </div>
          )}

          <AnimatePresence>
            {lessonShelfOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
                className="w-full overflow-hidden"
              >
                {lessonShelfLoading ? (
                  <div className="pt-8 text-center text-sm text-muted-foreground/60">
                    {t('classroom.shelf.loading')}
                  </div>
                ) : (
                  <div className="pt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {visibleLessonShelf.map((item, index) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.04, duration: 0.35, ease: 'easeOut' }}
                        className="rounded-2xl border border-border/60 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl shadow-sm shadow-black/[0.03] dark:shadow-black/20 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">{item.title}</p>
                            <p className="mt-1 text-xs text-muted-foreground/60">
                              {item.subject || t('classroom.shelf.generalSubject')}
                              {item.language ? ` · ${item.language}` : ''}
                            </p>
                          </div>
                          <span className={cn(
                            'shrink-0 rounded-full px-2 py-1 text-[11px] font-medium capitalize',
                            item.status === 'ready' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                            item.status === 'generating' && 'bg-teal-500/10 text-teal-700 dark:text-teal-300',
                            item.status === 'failed' && 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
                            item.status === 'archived' && 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-300',
                          )}>
                            {item.status}
                          </span>
                        </div>

                        <div className="mt-3 h-2 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500"
                            style={{ width: `${Math.max(4, Math.min(100, item.progress_pct || 0))}%` }}
                          />
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground/50">
                          <span>
                            {item.updated_at
                              ? new Date(item.updated_at).toLocaleDateString()
                              : t('classroom.shelf.justNow')}
                          </span>
                          {item.failure_reason ? <span className="truncate max-w-[60%]">{item.failure_reason}</span> : null}
                        </div>

                        <div className="mt-4 grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                          <button
                            onClick={() => handleOpenShelfItem(item)}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
                          >
                            {t('classroom.shelf.open')}
                          </button>
                          <button
                            onClick={() => handleRenameShelfItem(item)}
                            disabled={pendingShelfAction === item.id}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-xs font-medium text-foreground/80 hover:bg-muted/60 transition-colors disabled:opacity-50"
                          >
                            <Pencil className="size-3.5" />
                            {t('classroom.shelf.rename')}
                          </button>
                          {item.status === 'archived' ? (
                            <button
                              onClick={() => handleReopenShelfItem(item)}
                              disabled={pendingShelfAction === item.id}
                              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-xs font-medium text-foreground/80 hover:bg-muted/60 transition-colors disabled:opacity-50"
                            >
                              {t('classroom.shelf.reopen')}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleArchiveShelfItem(item)}
                              disabled={pendingShelfAction === item.id}
                              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-xs font-medium text-foreground/80 hover:bg-muted/60 transition-colors disabled:opacity-50"
                            >
                              <Trash2 className="size-3.5" />
                              {t('classroom.shelf.archive')}
                            </button>
                          )}
                          {item.status === 'failed' ? (
                            <button
                              onClick={() => handleRetryShelfItem(item)}
                              disabled={pendingShelfAction === item.id}
                              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-2 text-xs font-medium text-teal-700 dark:text-teal-300 hover:bg-teal-500/15 transition-colors disabled:opacity-50"
                            >
                              {t('classroom.shelf.retry')}
                            </button>
                          ) : null}
                        </div>
                      </motion.div>
                    ))}
                    {visibleLessonShelf.length === 0 ? (
                      <div className="col-span-full rounded-2xl border border-dashed border-border/60 bg-white/60 dark:bg-neutral-900/60 p-8 text-center text-sm text-muted-foreground/60">
                        {t('classroom.shelf.empty')}
                      </div>
                    ) : null}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* ═══ Recent classrooms — collapsible ═══ */}
      {isAuthenticated && classrooms.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="relative z-10 mt-10 w-full max-w-6xl flex flex-col items-center"
        >
          {/* Trigger — divider-line with centered text */}
          <button
            onClick={() => {
              const next = !recentOpen;
              setRecentOpen(next);
              try {
                localStorage.setItem(RECENT_OPEN_STORAGE_KEY, String(next));
              } catch {
                /* ignore */
              }
            }}
            className="group w-full flex items-center gap-4 py-2 cursor-pointer"
          >
            <div className="flex-1 h-px bg-border/40 group-hover:bg-border/70 transition-colors" />
            <span className="shrink-0 flex items-center gap-2 text-[13px] text-muted-foreground/60 group-hover:text-foreground/70 transition-colors select-none">
              <Clock className="size-3.5" />
              {t('classroom.recentClassrooms')}
              <span className="text-[11px] tabular-nums opacity-60">{classrooms.length}</span>
              <motion.div
                animate={{ rotate: recentOpen ? 180 : 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
              >
                <ChevronDown className="size-3.5" />
              </motion.div>
            </span>
            <div className="flex-1 h-px bg-border/40 group-hover:bg-border/70 transition-colors" />
          </button>

          {/* Expandable content */}
          <AnimatePresence>
            {recentOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
                className="w-full overflow-hidden"
              >
                <div className="pt-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-8">
                  {classrooms.map((classroom, i) => (
                    <motion.div
                      key={classroom.id}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: i * 0.04,
                        duration: 0.35,
                        ease: 'easeOut',
                      }}
                    >
                      <ClassroomCard
                        classroom={classroom}
                        slide={thumbnails[classroom.id]}
                        formatDate={formatDate}
                        onDelete={handleDelete}
                        onRename={handleRename}
                        confirmingDelete={pendingDeleteId === classroom.id}
                        onConfirmDelete={() => confirmDelete(classroom.id)}
                        onCancelDelete={() => setPendingDeleteId(null)}
                        onClick={() => router.push(`/lessons/${classroom.id}`)}
                      />
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
      {/* ═══ Philosophical Marketing Layout (Landing Page Only) ═══ */}
      {(!isAuthenticated || classrooms.length === 0) && (
        <div className="w-full mt-auto relative z-10">
          <MissionSection />
          <UseCasesSection />
          <FinalCTA />
        </div>
      )}

      {/* ═══ Footer ═══ */}
      <footer className="w-full relative z-10 pt-16 pb-10 flex flex-col items-center justify-center bg-background transition-colors duration-300">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-muted/20 pointer-events-none" />
        
        {/* Separator */}
        <div className="w-full max-w-6xl mx-auto px-4 mb-10 relative">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
        </div>
        <div className="flex items-center gap-2 mb-4 cursor-default select-none relative">
          <BotOff className="size-5 text-primary stroke-[2]" />
          <span className="text-lg font-bold tracking-tight text-primary">
            AI-Tutor
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-4 font-medium relative text-center">
          Empowering education with open-source artificial intelligence.
        </p>
        <div className="flex items-center gap-5 text-xs text-muted-foreground/80 relative">
          <a href="#" className="hover:text-primary transition-colors">Privacy</a>
          <a href="#" className="hover:text-primary transition-colors">Terms</a>
          <a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">GitHub</a>
        </div>
        <div className="mt-6 text-[11px] text-muted-foreground/40 relative">
          &copy; {new Date().getFullYear()} AI-Tutor Open Source Project. All rights reserved.
        </div>
      </footer>
    </div>
  );
}

// ─── Greeting Bar — avatar + "Hi, Name", click to edit in-place ────
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

function isCustomAvatar(src: string) {
  return src.startsWith('data:');
}

function GreetingBar() {
  const { t } = useI18n();
  const avatar = useUserProfileStore((s) => s.avatar);
  const nickname = useUserProfileStore((s) => s.nickname);
  const bio = useUserProfileStore((s) => s.bio);
  const setAvatar = useUserProfileStore((s) => s.setAvatar);
  const setNickname = useUserProfileStore((s) => s.setNickname);
  const setBio = useUserProfileStore((s) => s.setBio);

  const [open, setOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayName = nickname || t('profile.defaultNickname');

  // Click-outside to collapse
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingName(false);
        setAvatarPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const startEditName = () => {
    setNameDraft(nickname);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const commitName = () => {
    setNickname(nameDraft.trim());
    setEditingName(false);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_AVATAR_SIZE) {
      toast.error(t('profile.fileTooLarge'));
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error(t('profile.invalidFileType'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const scale = Math.max(128 / img.width, 128 / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h);
        setAvatar(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div ref={containerRef} className="relative pl-4 pr-2 pt-3.5 pb-1 w-auto">
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarUpload}
      />

      {/* ── Collapsed pill (always in flow) ── */}
      {!open && (
        <div
          className="flex items-center gap-2.5 cursor-pointer transition-all duration-200 group rounded-full px-2.5 py-1.5 border border-border/50 text-muted-foreground/70 hover:text-foreground hover:bg-muted/60 active:scale-[0.97]"
          onClick={() => setOpen(true)}
        >
          <div className="shrink-0 relative">
            <div className="size-8 rounded-full overflow-hidden ring-[1.5px] ring-border/30 group-hover:ring-primary/60 dark:group-hover:ring-primary/40 transition-all duration-300">
              <img src={avatar} alt="" className="size-full object-cover" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-white dark:bg-neutral-800 border border-border/40 flex items-center justify-center opacity-60 group-hover:opacity-100 transition-opacity">
              <Pencil className="size-[7px] text-muted-foreground/70" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="leading-none select-none flex items-center gap-1 pointer-events-none">
                  <span className="text-[13px] font-bold text-emerald-700 dark:text-emerald-400 group-hover:text-emerald-800 dark:group-hover:text-emerald-300 transition-colors uppercase tracking-wider">
                    Personalize the teacher
                  </span>
                  <ChevronDown className="size-3 text-emerald-600/50 group-hover:text-emerald-600 transition-colors shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                {t('profile.editTooltip')}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      {/* ── Expanded panel (absolute, floating) ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="absolute left-4 top-3.5 z-50 w-64"
          >
            <div className="rounded-2xl bg-white/95 dark:bg-neutral-800/95 backdrop-blur-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06] shadow-[0_1px_8px_-2px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_8px_-2px_rgba(0,0,0,0.3)] px-2.5 py-2">
              {/* ── Row: avatar + name ── */}
              <div
                className="flex items-center gap-2.5 cursor-pointer transition-all duration-200"
                onClick={() => {
                  setOpen(false);
                  setEditingName(false);
                  setAvatarPickerOpen(false);
                }}
              >
                {/* Avatar */}
                <div
                  className="shrink-0 relative cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAvatarPickerOpen(!avatarPickerOpen);
                  }}
                >
                  <div className="size-8 rounded-full overflow-hidden ring-[1.5px] ring-primary/70 dark:ring-primary/40 transition-all duration-300">
                    <img src={avatar} alt="" className="size-full object-cover" />
                  </div>
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-white dark:bg-neutral-800 border border-border/60 flex items-center justify-center"
                  >
                    <ChevronDown
                      className={cn(
                        'size-2 text-muted-foreground/70 transition-transform duration-200',
                        avatarPickerOpen && 'rotate-180',
                      )}
                    />
                  </motion.div>
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  {editingName ? (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        ref={nameInputRef}
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitName();
                          if (e.key === 'Escape') {
                            setEditingName(false);
                          }
                        }}
                        onBlur={commitName}
                        maxLength={20}
                        placeholder={t('profile.defaultNickname')}
                        className="flex-1 min-w-0 h-6 bg-transparent border-b border-border/80 text-[13px] font-semibold text-foreground outline-none placeholder:text-muted-foreground/40"
                      />
                      <button
                        onClick={commitName}
                        className="shrink-0 size-5 rounded flex items-center justify-center text-primary hover:bg-primary/10 dark:hover:bg-primary/20"
                      >
                        <Check className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditName();
                      }}
                      className="group/name inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span className="text-[13px] font-semibold text-foreground/85 group-hover/name:text-foreground transition-colors">
                        {displayName}
                      </span>
                      <Pencil className="size-2.5 text-muted-foreground/30 opacity-0 group-hover/name:opacity-100 transition-opacity" />
                    </span>
                  )}
                </div>

                {/* Collapse arrow */}
                <motion.div
                  initial={{ opacity: 0, y: -2 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="shrink-0 size-6 rounded-full flex items-center justify-center hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
                >
                  <ChevronUp className="size-3.5 text-muted-foreground/50" />
                </motion.div>
              </div>

              {/* ── Expandable content ── */}
              <div className="pt-2" onClick={(e) => e.stopPropagation()}>
                {/* Avatar picker */}
                <AnimatePresence>
                  {avatarPickerOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="p-1 pb-2.5 flex items-center gap-1.5 flex-wrap">
                        {AVATAR_OPTIONS.map((url) => (
                          <button
                            key={url}
                            onClick={() => setAvatar(url)}
                            className={cn(
                              'size-7 rounded-full overflow-hidden bg-gray-50 dark:bg-gray-800 cursor-pointer transition-all duration-150',
                              'hover:scale-110 active:scale-95',
                              avatar === url
                                ? 'ring-2 ring-primary dark:ring-primary ring-offset-0'
                                : 'hover:ring-1 hover:ring-muted-foreground/30',
                            )}
                          >
                            <img src={url} alt="" className="size-full" />
                          </button>
                        ))}
                        <label
                          className={cn(
                            'size-7 rounded-full flex items-center justify-center cursor-pointer transition-all duration-150 border border-dashed',
                            'hover:scale-110 active:scale-95',
                            isCustomAvatar(avatar)
                              ? 'ring-2 ring-primary dark:ring-primary ring-offset-0 border-primary/30 dark:border-primary/60 bg-primary/5 dark:bg-primary/10'
                              : 'border-muted-foreground/30 text-muted-foreground/50 hover:border-muted-foreground/50',
                          )}
                          onClick={() => avatarInputRef.current?.click()}
                          title={t('profile.uploadAvatar')}
                        >
                          <ImagePlus className="size-3" />
                        </label>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Bio */}
                <UITextarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder={t('profile.bioPlaceholder')}
                  maxLength={200}
                  rows={2}
                  className="resize-none border-border/40 bg-transparent min-h-[72px] !text-[13px] !leading-relaxed placeholder:!text-[11px] placeholder:!leading-relaxed focus-visible:ring-1 focus-visible:ring-border/60"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Classroom Card — clean, minimal style ──────────────────────
function ClassroomCard({
  classroom,
  slide,
  formatDate,
  onDelete,
  onRename,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
  onClick,
}: {
  classroom: StageListItem;
  slide?: Slide;
  formatDate: (ts: number) => string;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onRename: (id: string, newName: string) => void;
  confirmingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const thumbRef = useRef<HTMLDivElement>(null);
  const [thumbWidth, setThumbWidth] = useState(0);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = thumbRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setThumbWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (editing) nameInputRef.current?.focus();
  }, [editing]);

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNameDraft(classroom.name);
    setEditing(true);
  };

  const commitRename = () => {
    if (!editing) return;
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== classroom.name) {
      onRename(classroom.id, trimmed);
    }
    setEditing(false);
  };

  return (
    <div className="group cursor-pointer" onClick={confirmingDelete ? undefined : onClick}>
      {/* Thumbnail — large radius, no border, subtle bg */}
      <div
        ref={thumbRef}
        className="relative w-full aspect-[16/9] rounded-2xl bg-neutral-100 dark:bg-neutral-800/80 overflow-hidden transition-transform duration-200 group-hover:scale-[1.02]"
      >
        {slide && thumbWidth > 0 ? (
          <ThumbnailSlide
            slide={slide}
            size={thumbWidth}
            viewportSize={slide.viewportSize ?? 1000}
            viewportRatio={slide.viewportRatio ?? 0.5625}
          />
        ) : !slide ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="size-12 rounded-2xl bg-gradient-to-br from-primary/10 to-emerald-100/50 dark:from-primary/20 dark:to-emerald-900/20 flex items-center justify-center">
              <span className="text-xl opacity-50">📄</span>
            </div>
          </div>
        ) : null}

        {/* Delete — top-right, only on hover */}
        <AnimatePresence>
          {!confirmingDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-2 size-7 opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 hover:bg-destructive/80 text-white hover:text-white backdrop-blur-sm rounded-full"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(classroom.id, e);
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-11 size-7 opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 hover:bg-black/50 text-white hover:text-white backdrop-blur-sm rounded-full"
                onClick={startRename}
              >
                <Pencil className="size-3.5" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Inline delete confirmation overlay */}
        <AnimatePresence>
          {confirmingDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/50 backdrop-blur-[6px]"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-[13px] font-medium text-white/90">
                {t('classroom.deleteConfirmTitle')}?
              </span>
              <div className="flex gap-2">
                <button
                  className="px-3.5 py-1 rounded-lg text-[12px] font-medium bg-white/15 text-white/80 hover:bg-white/25 backdrop-blur-sm transition-colors"
                  onClick={onCancelDelete}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="px-3.5 py-1 rounded-lg text-[12px] font-medium bg-red-500/90 text-white hover:bg-red-500 transition-colors"
                  onClick={onConfirmDelete}
                >
                  {t('classroom.delete')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Info — outside the thumbnail */}
      <div className="mt-2.5 px-1 flex items-center gap-2">
        <span className="shrink-0 inline-flex items-center rounded-full bg-primary/10 dark:bg-primary/20 px-2 py-0.5 text-[11px] font-medium text-primary dark:text-primary">
          {classroom.sceneCount} {t('classroom.slides')} · {formatDate(classroom.updatedAt)}
        </span>
        {editing ? (
          <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <input
              ref={nameInputRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setEditing(false);
              }}
              onBlur={commitRename}
              maxLength={100}
              placeholder={t('classroom.renamePlaceholder')}
              className="w-full bg-transparent border-b border-primary/60 text-[15px] font-medium text-foreground/90 outline-none placeholder:text-muted-foreground/40"
            />
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <p
                className="font-medium text-[15px] truncate text-foreground/90 min-w-0 cursor-text"
                onDoubleClick={startRename}
              >
                {classroom.name}
              </p>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              sideOffset={4}
              className="!max-w-[min(90vw,32rem)] break-words whitespace-normal"
            >
              <div className="flex items-center gap-1.5">
                <span className="break-all">{classroom.name}</span>
                <button
                  className="shrink-0 p-0.5 rounded hover:bg-foreground/10 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(classroom.name);
                    toast.success(t('classroom.nameCopied'));
                  }}
                >
                  <Copy className="size-3 opacity-60" />
                </button>
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return <HomePage />;
}
