'use client';

import { useRef, useEffect, useState } from 'react';
import type { PPTAudioElement } from '@/lib/types/slides';
import { useMediaGenerationStore, isMediaPlaceholder } from '@/lib/store/media-generation';
import { useSettingsStore } from '@/lib/store/settings';
import { useMediaStageId } from '@/lib/contexts/media-stage-context';
import { retryMediaTask } from '@/lib/media/media-orchestrator';
import { RotateCcw, Music, ShieldAlert, VolumeX, Play, Pause } from 'lucide-react';

export interface BaseAudioElementProps {
  elementInfo: PPTAudioElement;
}

export function BaseAudioElement({ elementInfo }: BaseAudioElementProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  const stageId = useMediaStageId();
  const isPlaceholder = isMediaPlaceholder(elementInfo.src);
  const task = useMediaGenerationStore((s) => {
    if (!isPlaceholder) return undefined;
    const t = s.tasks[elementInfo.src];
    if (t && t.stageId !== stageId) return undefined;
    return t;
  });
  const audioGenerationEnabled = useSettingsStore((s) => s.imageGenerationEnabled);
  const resolvedSrc = task?.status === 'done' && task.objectUrl ? task.objectUrl : elementInfo.src;
  const showDisabled = isPlaceholder && !task && !audioGenerationEnabled;
  const showSkeleton = isPlaceholder && !showDisabled && (!task || task.status === 'pending' || task.status === 'generating');
  const showError = isPlaceholder && task?.status === 'failed';
  const isReady = !isPlaceholder || task?.status === 'done';

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (elementInfo.autoplay && isReady) {
      audio.play().catch(() => {});
    }
  }, [elementInfo.autoplay, isReady]);

  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  return (
    <div
      className="absolute"
      data-audio-element
      style={{
        top: `${elementInfo.top}px`,
        left: `${elementInfo.left}px`,
        width: `${elementInfo.width}px`,
        height: `${elementInfo.height}px`,
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="w-full h-full flex items-center justify-center"
        style={{ transform: `rotate(${elementInfo.rotate}deg)` }}
      >
        {showDisabled ? (
          <div className="w-full h-full bg-gray-50 dark:bg-gray-900/30 flex items-center justify-center rounded">
            <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-gray-500 dark:text-gray-400">
              <VolumeX className="w-3 h-3 shrink-0" />
              <span>Audio generation disabled</span>
            </div>
          </div>
        ) : showSkeleton ? (
          <div className="w-full h-full bg-gradient-to-br from-primary/5 via-emerald-50/40 to-primary/5 dark:from-primary/10 dark:via-emerald-950/20 dark:to-primary/5 flex items-center justify-center rounded">
            <Music className="w-8 h-8 text-primary/40 animate-pulse" strokeWidth={1.5} />
          </div>
        ) : showError ? (
          <div className="w-full h-full bg-red-50 dark:bg-red-900/20 flex flex-col items-center justify-center gap-1.5 rounded">
            {task?.errorCode === 'CONTENT_SENSITIVE' ? (
              <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-teal-600 dark:text-teal-400">
                <ShieldAlert className="w-3 h-3 shrink-0" />
                <span>Content filtered</span>
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); retryMediaTask(elementInfo.src); }}
                onPointerDown={(e) => e.stopPropagation()}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 rounded"
              >
                <RotateCcw className="w-3 h-3" />
                Retry
              </button>
            )}
          </div>
        ) : isReady && resolvedSrc ? (
          <div
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer select-none"
            style={{ backgroundColor: elementInfo.color || 'rgba(0,0,0,0.05)' }}
            onClick={(e) => { e.stopPropagation(); handlePlayPause(); }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {playing ? <Pause className="w-4 h-4 shrink-0" /> : <Play className="w-4 h-4 shrink-0" />}
            <div className="flex-1 h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: '0%' }} />
            </div>
            <audio
              ref={audioRef}
              src={resolvedSrc}
              preload="metadata"
              loop={elementInfo.loop}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
            />
          </div>
        ) : (
          <div className="w-10 h-10 flex items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
            <Music className="w-5 h-5 text-gray-400" strokeWidth={1.5} />
          </div>
        )}
      </div>
    </div>
  );
}
