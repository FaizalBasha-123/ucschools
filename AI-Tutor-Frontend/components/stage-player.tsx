'use client';

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  SkipForward,
  Volume2,
  VolumeX,
  MessageCircle,
  Presentation,
  CheckCircle2,
  XCircle,
  Sparkles,
  Home,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import type {
  Lesson,
  Scene,
  LessonAction,
  SlideElement,
  QuizQuestion,
} from '@/lib/api';
import { gradeQuiz, streamTutorChat } from '@/lib/api';
import type { TutorStreamEvent, QuizGradeResponse } from '@/lib/api';
import { InterleavedParser } from '@/apps/web/lib/stream-parser';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Stage Player — OpenMAIC-style lesson runtime
// ---------------------------------------------------------------------------

export function StagePlayer({ lesson }: { lesson: Lesson }) {
  const router = useRouter();
  const sortedScenes = useMemo(
    () => [...lesson.scenes].sort((a, b) => a.order - b.order),
    [lesson],
  );

  const [sceneIndex, setSceneIndex] = useState(0);
  const [actionIndex, setActionIndex] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const currentScene = sortedScenes[sceneIndex] as Scene | undefined;
  const currentAction = currentScene?.actions?.[actionIndex] as
    | LessonAction
    | undefined;

  // Audio ref for speech actions
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Live Whiteboard Elements
  const [liveElements, setLiveElements] = useState<SlideElement[]>([]);

  // Navigate scenes
  const goScene = useCallback(
    (dir: 1 | -1) => {
      const next = sceneIndex + dir;
      if (next >= 0 && next < sortedScenes.length) {
        setSceneIndex(next);
        setActionIndex(0);
        setIsPlaying(false);
      }
    },
    [sceneIndex, sortedScenes.length],
  );

  // Step actions
  const stepAction = useCallback(
    (dir: 1 | -1 = 1) => {
      if (!currentScene) return;
      const next = actionIndex + dir;
      if (next >= 0 && next < currentScene.actions.length) {
        setActionIndex(next);
      } else if (dir === 1 && sceneIndex < sortedScenes.length - 1) {
        goScene(1);
      }
    },
    [actionIndex, currentScene, sceneIndex, sortedScenes.length, goScene],
  );

  // Auto-play speech audio
  useEffect(() => {
    if (
      currentAction?.type === 'speech' &&
      currentAction.audio_url &&
      isPlaying &&
      !isMuted
    ) {
      const audio = new Audio(currentAction.audio_url);
      audioRef.current = audio;
      audio.play().catch(() => {});
      audio.onended = () => stepAction(1);
      return () => {
        audio.pause();
        audio.onended = null;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAction, isPlaying, isMuted]);

  const togglePlay = () => {
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
    }
  };

  const progress = currentScene
    ? ((actionIndex + 1) / Math.max(currentScene.actions.length, 1)) * 100
    : 0;

  return (
    <div className="h-[100dvh] w-full bg-background flex flex-col overflow-hidden">
      {/* ═══ Header ═══ */}
      <header className="shrink-0 h-12 border-b border-border/50 bg-background/80 backdrop-blur-sm flex items-center px-4 gap-3 z-20">
        <button
          onClick={() => router.push('/')}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
        >
          <Home className="size-4 text-muted-foreground" />
        </button>
        <div className="w-px h-5 bg-border" />
        <h1 className="text-sm font-semibold truncate flex-1">
          {lesson.title}
        </h1>
        <span className="text-xs text-muted-foreground tabular-nums">
          Scene {sceneIndex + 1} / {sortedScenes.length}
        </span>
      </header>

      {/* ═══ Main content ═══ */}
      <div className="flex-1 flex min-h-0">
        {/* ── Sidebar — scene list ── */}
        <aside className="hidden md:flex w-64 border-r border-border/50 flex-col bg-muted/30 overflow-y-auto">
          <div className="p-3 border-b border-border/30">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Scenes
            </p>
          </div>
          <div className="flex-1 p-2 space-y-1">
            {sortedScenes.map((scene, i) => (
              <button
                key={scene.id}
                onClick={() => {
                  setSceneIndex(i);
                  setActionIndex(0);
                  setLiveElements([]);
                }}
                className={cn(
                  'w-full text-left rounded-xl px-3 py-2.5 text-[13px] transition-all',
                  i === sceneIndex
                    ? 'bg-primary/10 text-primary font-medium shadow-sm border border-primary/20'
                    : 'hover:bg-muted/60 text-muted-foreground',
                )}
              >
                <span className="text-[11px] text-muted-foreground/60 tabular-nums">
                  {scene.order}.
                </span>{' '}
                {scene.title}
                <span className="block text-[10px] mt-0.5 text-muted-foreground/50 capitalize">
                  {scene.content.type}
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* ── Center stage ── */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Content area */}
          <div className="flex-1 overflow-auto p-4 md:p-6">
            <AnimatePresence mode="wait">
              {currentScene && (
                <motion.div
                  key={currentScene.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  className="h-full"
                >
                  {currentScene.content.type === 'slide' &&
                    currentScene.content.canvas && (
                      <SlideView
                        canvas={currentScene.content.canvas}
                        liveElements={liveElements}
                        highlightedElementId={currentAction?.element_id}
                      />
                    )}
                  {currentScene.content.type === 'quiz' &&
                    currentScene.content.questions && (
                      <QuizView
                        lessonId={lesson.id}
                        sceneId={currentScene.id}
                        questions={currentScene.content.questions}
                      />
                    )}
                  {currentScene.content.type === 'interactive' && (
                    <InteractiveView
                      html={currentScene.content.html}
                      url={currentScene.content.url}
                    />
                  )}
                  {currentScene.content.type === 'project' &&
                    currentScene.content.project_config && (
                      <ProjectView
                        config={currentScene.content.project_config}
                      />
                    )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Speech bubble */}
          {currentAction?.type === 'speech' && currentAction.text && (
            <div className="shrink-0 mx-4 md:mx-6 mb-2">
              <div className="rounded-xl border border-border/50 bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm px-4 py-3 text-sm leading-relaxed text-foreground/85 max-h-24 overflow-y-auto">
                {currentAction.text}
              </div>
            </div>
          )}

          {/* ═══ Toolbar ═══ */}
          <div className="shrink-0 border-t border-border/50 bg-background/80 backdrop-blur-sm px-4 py-2 flex items-center gap-3">
            {/* Progress */}
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Controls */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => goScene(-1)}
                disabled={sceneIndex === 0}
                className="p-2 rounded-lg hover:bg-muted disabled:opacity-30 transition-all"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                onClick={togglePlay}
                className="p-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 shadow-sm transition-all"
              >
                {isPlaying ? (
                  <Pause className="size-4" />
                ) : (
                  <Play className="size-4" />
                )}
              </button>
              <button
                onClick={() => stepAction(1)}
                className="p-2 rounded-lg hover:bg-muted transition-all"
              >
                <SkipForward className="size-4" />
              </button>
              <button
                onClick={() => goScene(1)}
                disabled={sceneIndex >= sortedScenes.length - 1}
                className="p-2 rounded-lg hover:bg-muted disabled:opacity-30 transition-all"
              >
                <ChevronRight className="size-4" />
              </button>
              <div className="w-px h-5 bg-border mx-1" />
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="p-2 rounded-lg hover:bg-muted transition-all"
              >
                {isMuted ? (
                  <VolumeX className="size-4 text-muted-foreground" />
                ) : (
                  <Volume2 className="size-4" />
                )}
              </button>
              <button
                onClick={() => setChatOpen(!chatOpen)}
                className={cn(
                  'p-2 rounded-lg transition-all',
                  chatOpen
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-muted text-muted-foreground',
                )}
              >
                <MessageCircle className="size-4" />
              </button>
            </div>
          </div>
        </main>

        {/* ── Chat panel ── */}
        <AnimatePresence>
          {chatOpen && currentScene && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 340, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="border-l border-border/50 bg-muted/20 overflow-hidden flex flex-col"
            >
              <DiscussionPanel
                lessonId={lesson.id}
                scene={currentScene}
                currentAction={currentAction}
                onAction={(action) => {
                  if (
                    action.name === 'wb_draw_text' ||
                    action.name === 'wb_draw_latex' ||
                    action.name === 'wb_draw_shape' ||
                    action.name === 'wb_draw_chart'
                  ) {
                    setLiveElements((prev) => [
                      ...prev,
                      {
                        id: action.params?.elementId || `wb_el_${Date.now()}`,
                        kind:
                          action.name === 'wb_draw_text' ||
                          action.name === 'wb_draw_latex'
                            ? 'text'
                            : action.name === 'wb_draw_shape'
                              ? 'shape'
                              : 'image',
                        x: action.params?.x || 0,
                        y: action.params?.y || 0,
                        width: action.params?.width || 200,
                        height: action.params?.height || 100,
                        content: action.params?.content || action.params?.latex || '',
                        background_color: action.params?.backgroundColor,
                        font_size: action.params?.fontSize,
                      } as SlideElement,
                    ]);
                  } else if (action.name === 'wb_delete') {
                    setLiveElements((prev) =>
                      prev.filter((el) => el.id !== action.params?.elementId)
                    );
                  } else if (action.name === 'wb_clear') {
                    setLiveElements([]);
                  }
                }}
              />
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slide View — renders the canvas
// ---------------------------------------------------------------------------

function SlideView({
  canvas,
  liveElements,
  highlightedElementId,
}: {
  canvas: NonNullable<import('@/lib/api').SlideCanvas>;
  liveElements?: import('@/lib/api').SlideElement[];
  highlightedElementId?: string;
}) {
  const scale =
    typeof window !== 'undefined'
      ? Math.min(
          (window.innerWidth - 340) / canvas.viewport_width,
          (window.innerHeight - 200) / canvas.viewport_height,
          1,
        )
      : 0.6;

  return (
    <div className="flex items-center justify-center h-full">
      <div
        className="relative rounded-xl border border-border/40 shadow-lg overflow-hidden"
        style={{
          width: canvas.viewport_width * scale,
          height: canvas.viewport_height * scale,
          backgroundColor: canvas.background_color || '#ffffff',
        }}
      >
        {(liveElements && liveElements.length > 0 ? liveElements : canvas.elements).map((el) => (
          <div
            key={el.id}
            className={cn(
              'absolute transition-all duration-300',
              highlightedElementId === el.id &&
                'ring-2 ring-purple-500/60 ring-offset-2 rounded-md',
            )}
            style={{
              left: el.x * scale,
              top: el.y * scale,
              width: el.width * scale,
              height: el.height * scale,
              backgroundColor: el.background_color || 'transparent',
              borderRadius: el.border_radius ? el.border_radius * scale : undefined,
              transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
              opacity: el.opacity ?? 1,
            }}
          >
            {el.kind === 'text' && (
              <p
                style={{
                  fontSize: (el.font_size || 16) * scale,
                  color: el.font_color || '#000',
                  fontWeight: el.font_weight || 'normal',
                  fontStyle: el.font_style || 'normal',
                  textAlign: (el.text_align as React.CSSProperties['textAlign']) || 'left',
                  padding: 4 * scale,
                  lineHeight: 1.4,
                  overflow: 'hidden',
                }}
              >
                {el.content}
              </p>
            )}
            {el.kind === 'image' && el.src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={el.src}
                alt={el.alt || ''}
                className="w-full h-full object-cover rounded"
              />
            )}
            {el.kind === 'shape' && (
              <div
                className="w-full h-full"
                style={{
                  backgroundColor: el.background_color || '#e2e8f0',
                  border: el.stroke_color
                    ? `${el.stroke_width || 1}px solid ${el.stroke_color}`
                    : undefined,
                  borderRadius:
                    el.shape_type === 'circle' ? '50%' : el.border_radius,
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quiz View — interactive quiz with grading
// ---------------------------------------------------------------------------

function QuizView({
  lessonId,
  sceneId,
  questions,
}: {
  lessonId: string;
  sceneId: string;
  questions: QuizQuestion[];
}) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [result, setResult] = useState<QuizGradeResponse | null>(null);
  const [grading, setGrading] = useState(false);

  const selectAnswer = (qi: number, value: string) => {
    if (result) return;
    setAnswers((prev) => ({ ...prev, [qi]: value }));
  };

  const handleGrade = async () => {
    setGrading(true);
    try {
      const payload = {
        lesson_id: lessonId,
        scene_id: sceneId,
        answers: Object.entries(answers).map(([qi, selected]) => ({
          question_index: Number(qi),
          selected,
        })),
      };
      const res = await gradeQuiz(payload);
      setResult(res);
    } catch {
      toast.error('Failed to grade quiz.');
    } finally {
      setGrading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Score banner */}
      {result && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            'rounded-xl p-4 text-center font-medium',
            result.score_percent >= 70
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
              : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800',
          )}
        >
          Score: {result.correct}/{result.total} ({result.score_percent}%)
        </motion.div>
      )}

      {questions.map((q, qi) => {
        const gradeResult = result?.results.find(
          (r) => r.question_index === qi,
        );
        return (
          <div
            key={q.id}
            className="rounded-xl border border-border/50 bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm p-5"
          >
            <p className="font-medium text-sm mb-3">
              {qi + 1}. {q.question}
            </p>
            <div className="space-y-2">
              {q.options.map((opt) => {
                const selected = answers[qi] === opt.value;
                const isCorrect =
                  gradeResult && opt.value === gradeResult.correct_answer;
                const isWrong =
                  gradeResult && selected && !gradeResult.is_correct;
                return (
                  <button
                    key={opt.value}
                    onClick={() => selectAnswer(qi, opt.value)}
                    className={cn(
                      'w-full text-left rounded-lg border px-4 py-2.5 text-sm transition-all',
                      selected && !result
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/50 hover:bg-muted/50',
                      isCorrect &&
                        'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300',
                      isWrong &&
                        'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {isCorrect && <CheckCircle2 className="size-4" />}
                      {isWrong && <XCircle className="size-4" />}
                      <span className="font-medium">{opt.label}.</span>{' '}
                      {opt.value}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {!result && (
        <button
          onClick={handleGrade}
          disabled={grading || Object.keys(answers).length === 0}
          className="w-full h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-all"
        >
          {grading ? 'Grading...' : 'Submit Answers'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interactive View — renders HTML
// ---------------------------------------------------------------------------

function InteractiveView({
  html,
  url,
}: {
  html?: string | null;
  url?: string | null;
}) {
  if (html) {
    return (
      <div className="h-full flex items-center justify-center">
        <div
          className="w-full max-w-3xl rounded-xl border border-border/40 bg-white dark:bg-slate-900 p-6 shadow-sm overflow-auto"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }
  if (url) {
    return (
      <iframe
        src={url}
        className="w-full h-full rounded-xl border border-border/40"
        sandbox="allow-scripts allow-same-origin"
      />
    );
  }
  return (
    <div className="flex items-center justify-center h-full text-muted-foreground">
      No interactive content available.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project View — PBL summary
// ---------------------------------------------------------------------------

function ProjectView({ config }: { config: { summary: string } }) {
  return (
    <div className="max-w-2xl mx-auto flex items-center justify-center h-full">
      <div className="rounded-xl border border-border/50 bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm p-8 space-y-4">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="size-5" />
          <h3 className="font-semibold">Project-Based Learning</h3>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed">
          {config.summary}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Discussion Panel — chat with AI tutor
// ---------------------------------------------------------------------------

function DiscussionPanel({
  lessonId,
  scene,
  currentAction,
  onAction,
}: {
  lessonId: string;
  scene: Scene;
  currentAction?: LessonAction;
  onAction?: (action: any) => void;
}) {
  const [messages, setMessages] = useState<
    { role: 'user' | 'assistant'; content: string }[]
  >([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || streaming) return;
    const userMsg = { role: 'user' as const, content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);

    const assistantMsg = { role: 'assistant' as const, content: '' };
    setMessages((prev) => [...prev, assistantMsg]);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const parser = new InterleavedParser({
        onTextDelta: (delta) => {
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last?.role === 'assistant') {
              copy[copy.length - 1] = {
                ...last,
                content: last.content + delta,
              };
            }
            return copy;
          });
        },
        onAction: (action) => {
          if (onAction) onAction(action);
        },
      });

      await streamTutorChat(
        {
          lesson_id: lessonId,
          action_id: currentAction?.id || scene.actions[0]?.id || 'unknown',
          messages: newMessages,
          scene_context: scene.title,
          topic:
            currentAction?.type === 'discussion'
              ? currentAction.topic
              : undefined,
        },
        (event: TutorStreamEvent) => {
          if (event.kind === 'text_delta' && event.content) {
            // Feed text chunks through the parser (handles JSON extraction)
            parser.push(event.content);
          } else if (event.kind === 'action' && event.content) {
            // Direct action events from the backend (already validated)
            try {
              const action = JSON.parse(event.content);
              if (onAction && action.name) {
                onAction({ type: 'action', ...action });
              }
            } catch {
              // Ignore malformed action events
            }
          }
        },
        abort.signal,
      );
      // Finalize parser to catch plain-text fallback (Gap 6)
      parser.finalize();
    } catch {
      if (!abort.signal.aborted) {
        toast.error('Chat stream failed.');
      }
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border/30 flex items-center gap-2">
        <MessageCircle className="size-4 text-primary" />
        <p className="text-xs font-medium">Discussion</p>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground/50 text-center pt-8">
            Ask the AI tutor anything about this lesson.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              'rounded-xl px-3 py-2 text-[13px] leading-relaxed max-w-[90%]',
              msg.role === 'user'
                ? 'ml-auto bg-primary text-primary-foreground'
                : 'bg-muted/60',
            )}
          >
            {msg.content || (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <span className="size-1.5 bg-current rounded-full animate-pulse" />
                <span
                  className="size-1.5 bg-current rounded-full animate-pulse"
                  style={{ animationDelay: '150ms' }}
                />
                <span
                  className="size-1.5 bg-current rounded-full animate-pulse"
                  style={{ animationDelay: '300ms' }}
                />
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-border/30">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Ask a question..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            className="flex-1 h-9 rounded-lg border border-border/60 bg-background px-3 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <button
            onClick={sendMessage}
            disabled={streaming || !input.trim()}
            className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
