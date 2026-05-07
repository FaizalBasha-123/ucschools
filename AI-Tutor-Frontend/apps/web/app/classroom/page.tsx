'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  Loader2,
  BookOpen,
  Users,
  Folder,
  PlayCircle,
  Share2,
  Trash2,
  ArrowUp,
  Sparkles,
} from 'lucide-react';
import { verifyAuthSession, clearAuthSession, authHeaders } from '@/lib/auth/session';
import { fetchShelf, type LessonShelfItem } from '@/lib/lesson/shelf-client';
import { toast } from 'sonner';
import { nanoid } from 'nanoid';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { GenerationToolbar } from '@/components/generation/generation-toolbar';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { storePdfBlob } from '@/lib/utils/image-storage';
import type { UserRequirements } from '@/lib/types/generation';
import { SpeechButton } from '@/components/audio/speech-button';
import { cn } from '@/lib/utils';
import { Header } from '@/components/header';
import { LeftSidebar } from '@/components/layout/left-sidebar';
import { UserMenu } from '@/components/layout/user-menu';
import { CreditsDisplay } from '@/components/layout/credits-display';
import { SettingsDialog } from '@/components/settings';

// ── Pending lesson storage key (written by landing page on unauthenticated submit)
const PENDING_LESSON_KEY = 'pendingLesson';

interface PendingLesson {
  requirement: string;
  language: string;
  webSearch: boolean;
}

function readAndClearPendingLesson(): PendingLesson | null {
  try {
    const raw = localStorage.getItem(PENDING_LESSON_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingLesson;
    // Don't clear yet — wait until generate is confirmed
    return parsed;
  } catch {
    return null;
  }
}

function clearPendingLesson() {
  try {
    localStorage.removeItem(PENDING_LESSON_KEY);
  } catch { /* ignore */ }
}

export default function ClassroomDashboard() {
  const router = useRouter();
  const { locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [lessons, setLessons] = useState<LessonShelfItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Generator state ──
  const [requirement, setRequirement] = useState('');
  const [language, setLanguage] = useState<string>(locale);
  const [webSearch, setWebSearch] = useState(true);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync locale → language (only when user hasn't typed anything yet)
  useEffect(() => {
    setLanguage(locale);
  }, [locale]);

  // ── On mount: pre-fill from pending lesson written by landing page ──
  useEffect(() => {
    const pending = readAndClearPendingLesson();
    if (pending) {
      if (pending.requirement) setRequirement(pending.requirement);
      if (pending.language) setLanguage(pending.language);
      setWebSearch(pending.webSearch ?? true);
      // Auto-focus so user sees the pre-filled text immediately
      setTimeout(() => textareaRef.current?.focus(), 150);
    }
  }, []);

  useEffect(() => {
    async function initDashboard() {
      try {
        const isVerified = await verifyAuthSession();
        if (!isVerified) {
          router.replace('/auth?mode=signin&next=/classroom');
          return;
        }
        const response = await fetchShelf();
        setLessons(response.items || []);
      } catch (err) {
        console.error('Failed to initialize dashboard:', err);
        toast.error('Failed to load lessons');
      } finally {
        setLoading(false);
      }
    }
    initDashboard();
  }, [router]);

  // ── Generate handler ──
  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;

    if (!requirement.trim()) {
      setError('Please describe what you want to learn.');
      return;
    }

    setError(null);
    setIsGenerating(true);

    try {
      // 1. Billing check
      const billingRes = await fetch('/api/billing/dashboard', {
        method: 'GET',
        headers: authHeaders(),
        cache: 'no-store',
      });

      if (billingRes.ok) {
        const billingData = await billingRes.json();
        const creditBalance = billingData.data?.entitlement?.credit_balance ?? 0;
        const hasActiveSubscription = billingData.data?.entitlement?.has_active_subscription ?? false;

        if (!hasActiveSubscription && creditBalance <= 0) {
          toast.error('Insufficient credits', {
            description: 'Please choose a plan to generate lessons.',
          });
          router.push('/pricing');
          return;
        }
      }

      // 2. Build session
      const userProfile = useUserProfileStore.getState();
      const requirements: UserRequirements = {
        requirement: requirement.trim(),
        language,
        userNickname: userProfile.nickname || undefined,
        userBio: userProfile.bio || undefined,
        webSearch: webSearch || undefined,
      };

      let pdfStorageKey: string | undefined;
      let pdfFileName: string | undefined;
      let pdfProviderId: string | undefined;
      let pdfProviderConfig: { apiKey?: string; baseUrl?: string } | undefined;

      if (pdfFile) {
        pdfStorageKey = await storePdfBlob(pdfFile);
        pdfFileName = pdfFile.name;

        const settings = useSettingsStore.getState();
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
      };

      sessionStorage.setItem('generationSession', JSON.stringify(sessionState));

      // 3. Clear the pending lesson now that we're actually generating
      clearPendingLesson();

      router.push('/generation-preview');
    } catch (err) {
      console.error('Error preparing generation:', err);
      setError(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, requirement, language, webSearch, pdfFile, router]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const canGenerate = requirement.trim().length > 0;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-neutral-500">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  const myLessons = lessons.filter((l) => !l.is_shared && !l.group_id);
  const sharedLessons = lessons.filter((l) => l.is_shared);
  const groupedLessons = lessons.filter((l) => l.group_id);

  const LessonGrid = ({ items }: { items: LessonShelfItem[] }) => {
    if (items.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-24 text-neutral-400">
          <BookOpen className="h-12 w-12 mb-4 opacity-20" />
          <p className="text-sm">No lessons found in this section.</p>
          <p className="text-xs mt-1 opacity-60">Generate your first lesson using the input above.</p>
        </div>
      );
    }
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {items.map((lesson) => (
          <motion.div
            key={lesson.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="group relative bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl overflow-hidden hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/30 transition-all cursor-pointer flex flex-col"
            onClick={() => router.push(`/lessons/${lesson.lesson_id}`)}
          >
            <div className="aspect-video bg-neutral-100 dark:bg-neutral-800 relative overflow-hidden">
              {lesson.thumbnail_url ? (
                <img
                  src={lesson.thumbnail_url}
                  alt={lesson.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                    <PlayCircle className="h-7 w-7 text-primary/40" />
                  </div>
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Button
                  variant="secondary"
                  className="rounded-full shadow-lg pointer-events-none"
                >
                  Open Lesson
                </Button>
              </div>
            </div>
            <div className="p-5 flex-1 flex flex-col">
              <h3 className="font-semibold text-base text-neutral-900 dark:text-white line-clamp-1 mb-1">
                {lesson.title || 'Untitled Lesson'}
              </h3>
              <p className="text-xs text-neutral-500 line-clamp-1 mb-4">
                {lesson.subject || 'General'} · {lesson.language || 'English'}
              </p>

              <div className="mt-auto flex items-center justify-between">
                <div
                  className={cn(
                    'text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md',
                    lesson.status === 'ready'
                      ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600'
                      : lesson.status === 'generating'
                        ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-600'
                        : lesson.status === 'failed'
                          ? 'bg-red-50 dark:bg-red-900/20 text-red-600'
                          : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500',
                  )}
                >
                  {lesson.status}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      toast.info('Share feature coming soon!');
                    }}
                  >
                    <Share2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                    onClick={(e) => {
                      e.stopPropagation();
                      toast.info('Delete feature coming soon!');
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50 dark:bg-neutral-950">
      <LeftSidebar onSignOut={() => {
        clearAuthSession();
        router.push('/auth?mode=signin');
      }} />

      <div className="flex-1 flex flex-col min-w-0 relative">
        <Header
          currentSceneTitle="Classroom Dashboard"
          rightElement={
            <div className="flex items-center gap-4">
              <CreditsDisplay />
              <div className="w-[1px] h-6 bg-neutral-200 dark:bg-neutral-800" />
              <UserMenu onOpenSettings={() => setSettingsOpen(true)} />
            </div>
          }
        />

        <main className="flex-1 overflow-y-auto scrollbar-hide">
          <div className="max-w-7xl mx-auto px-4 py-6 md:px-6 md:py-10">
            {/* ── Hero: Quick generate input ── */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="mb-10"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-emerald-500 flex items-center justify-center shadow-lg shadow-primary/20">
                  <Sparkles className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">
                    Classroom Hub
                  </h1>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    Generate, manage, and organize all your lessons.
                  </p>
                </div>
              </div>

              {/* Input box */}
              <div className="w-full rounded-2xl border border-border/60 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl shadow-xl shadow-black/[0.03] dark:shadow-black/20 transition-shadow focus-within:shadow-2xl focus-within:shadow-primary/[0.06]">
                <textarea
                  ref={textareaRef}
                  placeholder="What do you want to learn today?"
                  className="w-full resize-none border-0 bg-transparent px-4 pt-4 pb-2 text-[14px] md:text-[15px] leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none min-h-[48px] max-h-[200px]"
                  value={requirement}
                  onChange={(e) => setRequirement(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                />

                {/* Toolbar row */}
                <div className="px-3 pb-3 flex items-end gap-2">
                  <div className="flex-1 min-w-0">
                    <GenerationToolbar
                      language={language}
                      onLanguageChange={(lang) => setLanguage(lang)}
                      webSearch={webSearch}
                      onWebSearchChange={setWebSearch}
                      onSettingsOpen={() => {}}
                      pdfFile={pdfFile}
                      onPdfFileChange={setPdfFile}
                      onPdfError={setPdfError}
                    />
                  </div>

                  <SpeechButton
                    size="md"
                    onTranscription={(text) => {
                      setRequirement((prev) => prev + (prev ? ' ' : '') + text);
                    }}
                  />

                  <button
                    onClick={handleGenerate}
                    disabled={!canGenerate || isGenerating}
                    className={cn(
                      'shrink-0 h-8 w-8 rounded-lg flex items-center justify-center transition-all',
                      canGenerate && !isGenerating
                        ? 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm cursor-pointer'
                        : 'bg-muted text-muted-foreground/40 cursor-not-allowed',
                    )}
                  >
                    {isGenerating ? (
                      <Loader2 className="size-4 animate-spin text-primary" />
                    ) : (
                      <ArrowUp className="size-4" />
                    )}
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="mt-2 text-xs text-red-500 px-1"
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>
              {pdfError && (
                <p className="mt-1 text-xs text-red-500 px-1">{pdfError}</p>
              )}
            </motion.div>

            {/* ── Lesson Tabs ── */}
            <Tabs defaultValue="my-lessons" className="w-full">
              <TabsList className="mb-8 w-full max-w-md grid grid-cols-3 h-12 rounded-xl bg-neutral-200/50 dark:bg-neutral-900/50 p-1">
                <TabsTrigger
                  value="my-lessons"
                  className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-800 data-[state=active]:shadow-sm"
                >
                  <BookOpen className="w-4 h-4 mr-2" />
                  My Lessons
                </TabsTrigger>
                <TabsTrigger
                  value="groups"
                  className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-800 data-[state=active]:shadow-sm"
                >
                  <Folder className="w-4 h-4 mr-2" />
                  Groups
                </TabsTrigger>
                <TabsTrigger
                  value="shared"
                  className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-800 data-[state=active]:shadow-sm"
                >
                  <Users className="w-4 h-4 mr-2" />
                  Shared
                </TabsTrigger>
              </TabsList>

              <TabsContent value="my-lessons" className="focus-visible:outline-none focus-visible:ring-0">
                <LessonGrid items={myLessons} />
              </TabsContent>
              <TabsContent value="groups" className="focus-visible:outline-none focus-visible:ring-0">
                <LessonGrid items={groupedLessons} />
              </TabsContent>
              <TabsContent value="shared" className="focus-visible:outline-none focus-visible:ring-0">
                <LessonGrid items={sharedLessons} />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
