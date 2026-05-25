'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Send, HelpCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStageStore } from '@/lib/store';
import { useSettingsStore } from '@/lib/store/settings';
import type {
  WhiteboardActionEvent,
  WhiteboardDoubtResponse,
  WbDrawTextEvent,
  WbDrawShapeEvent,
  WbDrawArrowEvent,
  WbDrawImageEvent,
} from '@/lib/types/whiteboard-doubt';
import { toast } from 'sonner';

// ─── Canvas coordinate space ──────────────────────────────────────────────────
// The backend emits coordinates in 960×540 space.
// We scale them to the rendered canvas size.
const WB_W = 960;
const WB_H = 540;

// ─── Types ────────────────────────────────────────────────────────────────────

interface DrawnItem {
  id: string;
  event: WhiteboardActionEvent;
}

interface WhiteboardDoubtSessionProps {
  /** Whether the doubt panel is open */
  isOpen: boolean;
  /** Called when user closes/ends the session */
  onClose: () => void;
  /** Lesson ID (stage.id) for API calls */
  lessonId: string;
  /** Current scene index */
  sceneIndex: number;
  /** Current scene title */
  sceneTitle: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authHeaders(): HeadersInit {
  // The Next.js API route handles auth forwarding; the browser just needs its cookie.
  return { 'Content-Type': 'application/json' };
}

// ─── Canvas renderer ──────────────────────────────────────────────────────────

function WbCanvas({
  items,
  containerWidth,
  containerHeight,
}: {
  items: DrawnItem[];
  containerWidth: number;
  containerHeight: number;
}) {
  const scaleX = containerWidth / WB_W;
  const scaleY = containerHeight / WB_H;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {items.map(({ id, event }) => {
        if (event.type === 'draw_text') {
          const e = event as WbDrawTextEvent;
          return (
            <motion.div
              key={id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute select-none"
              style={{
                left: e.x * scaleX,
                top: e.y * scaleY,
                fontSize: e.font_size * Math.min(scaleX, scaleY),
                color: e.color,
                fontWeight: 600,
                lineHeight: 1.3,
                maxWidth: `${(WB_W - e.x) * scaleX}px`,
                whiteSpace: 'pre-wrap',
                fontFamily: 'Inter, system-ui, sans-serif',
              }}
            >
              {e.content}
            </motion.div>
          );
        }

        if (event.type === 'draw_shape') {
          const e = event as WbDrawShapeEvent;
          const w = e.width * scaleX;
          const h = e.height * scaleY;
          const x = e.x * scaleX;
          const y = e.y * scaleY;
          const fill = e.fill_color ?? 'transparent';
          const stroke = e.stroke_color;

          if (e.shape === 'circle') {
            const rx = w / 2;
            const ry = h / 2;
            return (
              <motion.svg
                key={id}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute overflow-visible"
                style={{ left: x, top: y, width: w, height: h }}
              >
                <ellipse cx={rx} cy={ry} rx={rx - 1} ry={ry - 1} fill={fill} stroke={stroke} strokeWidth={2} />
              </motion.svg>
            );
          }

          if (e.shape === 'triangle') {
            return (
              <motion.svg
                key={id}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute overflow-visible"
                style={{ left: x, top: y, width: w, height: h }}
              >
                <polygon points={`${w / 2},0 ${w},${h} 0,${h}`} fill={fill} stroke={stroke} strokeWidth={2} />
              </motion.svg>
            );
          }

          // rectangle (default)
          return (
            <motion.svg
              key={id}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute overflow-visible"
              style={{ left: x, top: y, width: w, height: h }}
            >
              <rect x={1} y={1} width={w - 2} height={h - 2} fill={fill} stroke={stroke} strokeWidth={2} rx={4} />
            </motion.svg>
          );
        }

        if (event.type === 'draw_arrow') {
          const e = event as WbDrawArrowEvent;
          const x1 = e.start_x * scaleX;
          const y1 = e.start_y * scaleY;
          const x2 = e.end_x * scaleX;
          const y2 = e.end_y * scaleY;
          const svgW = Math.abs(x2 - x1) + 20;
          const svgH = Math.abs(y2 - y1) + 20;
          const offX = Math.min(x1, x2) - 10;
          const offY = Math.min(y1, y2) - 10;
          return (
            <motion.svg
              key={id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute overflow-visible pointer-events-none"
              style={{ left: offX, top: offY, width: svgW, height: svgH }}
            >
              <defs>
                <marker id={`arrow-${id}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill={e.color} />
                </marker>
              </defs>
              <line
                x1={x1 - offX} y1={y1 - offY}
                x2={x2 - offX} y2={y2 - offY}
                stroke={e.color}
                strokeWidth={2}
                markerEnd={`url(#arrow-${id})`}
              />
              {e.label && (
                <text
                  x={(x1 - offX + x2 - offX) / 2}
                  y={(y1 - offY + y2 - offY) / 2 - 4}
                  textAnchor="middle"
                  fill={e.color}
                  fontSize={11}
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {e.label}
                </text>
              )}
            </motion.svg>
          );
        }

        if (event.type === 'draw_image') {
          const e = event as WbDrawImageEvent;
          return (
            <motion.img
              key={id}
              src={e.url}
              alt={e.alt ?? 'whiteboard diagram'}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
              className="absolute rounded-lg shadow-md object-contain"
              style={{
                left: e.x * scaleX,
                top: e.y * scaleY,
                width: e.width * scaleX,
                height: e.height * scaleY,
              }}
            />
          );
        }

        return null;
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WhiteboardDoubtSession({
  isOpen,
  onClose,
  lessonId,
  sceneIndex,
  sceneTitle,
}: WhiteboardDoubtSessionProps) {
  const qualityMode = useSettingsStore((s) => s.qualityMode ?? 'standard');

  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [wbSessionId, setWbSessionId] = useState<string | null>(null);
  const [drawnItems, setDrawnItems] = useState<DrawnItem[]>([]);
  const [speech, setSpeech] = useState<string | null>(null);
  // Count of questions asked this session (each costs exactly 0.1 credits)
  const [callCount, setCallCount] = useState(0);

  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cleanedUpRef = useRef(false);

  // Observe canvas container size for coordinate scaling
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setCanvasSize({
          w: entry.contentRect.width,
          h: entry.contentRect.height,
        });
      }
    });
    ro.observe(el);
    setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [isOpen]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  // Cleanup on unmount or close
  const cleanup = useCallback(async () => {
    if (cleanedUpRef.current || !wbSessionId) return;
    cleanedUpRef.current = true;
    try {
      await fetch(`/api/lessons/${lessonId}/doubt/${wbSessionId}`, {
        method: 'DELETE',
      });
    } catch {
      // best-effort — Redis TTL handles it
    }
  }, [lessonId, wbSessionId]);

  useEffect(() => {
    if (!isOpen && wbSessionId) {
      cleanup();
      // Reset local state for next session
      setWbSessionId(null);
      setDrawnItems([]);
      setSpeech(null);
      setCallCount(0);
      cleanedUpRef.current = false;
    }
  }, [isOpen, wbSessionId, cleanup]);

  // beforeunload best-effort cleanup
  useEffect(() => {
    const handler = () => void cleanup();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [cleanup]);

  // Process action events from the backend response
  const applyActions = useCallback((actions: WhiteboardActionEvent[]) => {
    let delay = 0;
    for (const action of actions) {
      if (action.type === 'clear') {
        setTimeout(() => setDrawnItems([]), delay);
        delay += 150;
      } else if (action.type === 'speak') {
        setTimeout(() => setSpeech(action.text), delay);
        delay += 100;
      } else if (action.type === 'done') {
        // done is informational only — billing is flat 0.1/call, tracked by callCount
      } else if (
        action.type === 'draw_text' ||
        action.type === 'draw_shape' ||
        action.type === 'draw_arrow' ||
        action.type === 'draw_latex' ||
        action.type === 'draw_chart' ||
        action.type === 'draw_image'
      ) {
        setTimeout(() => {
          setDrawnItems((prev) => [...prev, { id: action.id, event: action }]);
        }, delay);
        delay += 180;
      }
    }
  }, []);

  const submitQuestion = useCallback(
    async (q: string) => {
      if (!q.trim() || isLoading) return;
      setIsLoading(true);
      setSpeech(null);

      try {
        if (!wbSessionId) {
          // First question — start session
          const res = await fetch(`/api/lessons/${lessonId}/doubt`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
              question: q.trim(),
              scene_index: sceneIndex,
              scene_title: sceneTitle,
              quality_mode: qualityMode,
              enable_image_generation: true,
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.message ?? `Error ${res.status}`);
          }
          const data: WhiteboardDoubtResponse = await res.json();
          setWbSessionId(data.wb_session_id);
          cleanedUpRef.current = false;
          applyActions(data.actions);
          setCallCount((c) => c + 1);
        } else {
          // Follow-up question
          const res = await fetch(`/api/lessons/${lessonId}/doubt/${wbSessionId}`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ question: q.trim() }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.message ?? `Error ${res.status}`);
          }
          const data: WhiteboardDoubtResponse = await res.json();
          applyActions(data.actions);
          setCallCount((c) => c + 1);
        }
        setQuestion('');
      } catch (e) {
        toast.error(`Whiteboard doubt failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, lessonId, sceneIndex, sceneTitle, qualityMode, wbSessionId, applyActions],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitQuestion(question);
    }
  };

  const handleEndSession = async () => {
    await cleanup();
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 130, damping: 20 } }}
          exit={{ opacity: 0, scale: 0.96, y: 12, transition: { duration: 0.22 } }}
          className={cn(
            'absolute inset-3 pointer-events-auto flex flex-col overflow-hidden',
            'bg-white/97 dark:bg-neutral-900/97 backdrop-blur-2xl',
            'rounded-2xl shadow-[0_24px_64px_-12px_rgba(0,0,0,0.22)]',
            'border border-violet-200/60 dark:border-violet-700/40',
            'ring-2 ring-violet-500/10 dark:ring-violet-400/10',
            'z-[130]',
          )}
        >
          {/* ── Header ─────────────────────────────────────────────────── */}
          <div className="h-12 px-4 flex items-center justify-between shrink-0 border-b border-gray-100 dark:border-neutral-800">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
                <HelpCircle className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-gray-800 dark:text-gray-100 leading-tight">
                  Ask a doubt
                </p>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[200px]">
                  {sceneTitle}
                </p>
              </div>
              {/* Live indicator when session is active */}
              {wbSessionId && (
                <span className="flex items-center gap-1 ml-2">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-violet-500" />
                  </span>
                  <span className="text-[10px] font-medium text-violet-500 dark:text-violet-400">Live</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {callCount > 0 && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500 mr-2">
                  {(callCount * 0.1).toFixed(2)} cr
                </span>
              )}
              <button
                onClick={handleEndSession}
                title={wbSessionId ? 'End session & clear' : 'Close'}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ── Speech bubble ────────────────────────────────────────────── */}
          <AnimatePresence>
            {speech && (
              <motion.div
                key={speech}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
                className="mx-4 mt-3 px-3.5 py-2.5 bg-violet-50 dark:bg-violet-900/20 rounded-xl border border-violet-100 dark:border-violet-800/40 shrink-0"
              >
                <p className="text-[12px] text-violet-800 dark:text-violet-200 leading-relaxed font-medium">
                  {speech}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Canvas area ───────────────────────────────────────────────── */}
          <div
            ref={canvasRef}
            className={cn(
              'flex-1 relative min-h-0 mx-4 mt-3 rounded-xl border border-gray-100 dark:border-neutral-800 overflow-hidden',
              'bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] dark:bg-[radial-gradient(#374151_1px,transparent_1px)] [background-size:20px_20px]',
              'bg-white dark:bg-neutral-950',
            )}
          >
            {/* Empty state */}
            {drawnItems.length === 0 && !isLoading && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-[12px] text-gray-300 dark:text-gray-600 select-none">
                  Ask a question to see the explanation here
                </p>
              </div>
            )}

            {/* Loading shimmer */}
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-2.5">
                  <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
                  <p className="text-[11px] text-gray-400 dark:text-gray-500">Preparing explanation…</p>
                </div>
              </div>
            )}

            {/* Drawn items */}
            {canvasSize.w > 0 && (
              <WbCanvas
                items={drawnItems}
                containerWidth={canvasSize.w}
                containerHeight={canvasSize.h}
              />
            )}
          </div>

          {/* ── Input area ────────────────────────────────────────────────── */}
          <div className="px-4 py-3 shrink-0 border-t border-gray-100 dark:border-neutral-800 mt-2">
            <div className={cn(
              'flex items-end gap-2 rounded-xl border px-3 py-2',
              'border-gray-200 dark:border-neutral-700',
              'bg-gray-50 dark:bg-neutral-800',
              'focus-within:border-violet-400 dark:focus-within:border-violet-500',
              'transition-colors duration-150',
            )}>
              <textarea
                ref={inputRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={wbSessionId ? 'Ask a follow-up…' : 'What would you like explained?'}
                rows={1}
                disabled={isLoading}
                className={cn(
                  'flex-1 resize-none bg-transparent text-[13px] text-gray-800 dark:text-gray-100',
                  'placeholder:text-gray-400 dark:placeholder:text-gray-500',
                  'outline-none leading-relaxed max-h-24 overflow-y-auto',
                  'disabled:opacity-50',
                )}
                style={{ fieldSizing: 'content' } as React.CSSProperties}
              />
              <button
                onClick={() => void submitQuestion(question)}
                disabled={!question.trim() || isLoading}
                className={cn(
                  'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all',
                  'bg-violet-600 text-white hover:bg-violet-700 active:scale-95',
                  'disabled:opacity-40 disabled:pointer-events-none',
                )}
              >
                {isLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-gray-300 dark:text-gray-600 text-center select-none">
              Ephemeral session · cleared on close · Enter to send
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
