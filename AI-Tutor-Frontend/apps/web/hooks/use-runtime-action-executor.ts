"use client";

import { useCallback, useState } from "react";

import type { ActionExecutionMetadata, LessonAction } from "@ai-tutor/types";

type WhiteboardExecutor = (action: LessonAction) => Promise<void>;

export function useRuntimeActionExecutor(executeWhiteboardAction: WhiteboardExecutor) {
  const [focusedElementId, setFocusedElementId] = useState<string | null>(null);
  const [focusedVideoElementId, setFocusedVideoElementId] = useState<string | null>(null);
  const [activeAudioActionId, setActiveAudioActionId] = useState<string | null>(null);
  const [audioPlaybackToken, setAudioPlaybackToken] = useState(0);

  const resetRuntimeSurface = useCallback(() => {
    setFocusedElementId(null);
    setFocusedVideoElementId(null);
    setActiveAudioActionId(null);
  }, []);

  const applyAction = useCallback(
    async (
      action: LessonAction,
      execution?: ActionExecutionMetadata | null,
    ) => {
      const surface = execution?.surface;

      if (surface === "audio" || action.type === "speech") {
        setActiveAudioActionId(action.id);
        setAudioPlaybackToken((current) => current + 1);
        return;
      }

      if (surface === "whiteboard" || action.type.startsWith("whiteboard_")) {
        await executeWhiteboardAction(action);
        return;
      }

      if (
        surface === "slide_overlay" ||
        action.type === "spotlight" ||
        action.type === "laser"
      ) {
        if (action.type === "spotlight" || action.type === "laser") {
          setFocusedElementId(action.element_id);
        }
        return;
      }

      if (surface === "video" || action.type === "play_video") {
        if (action.type === "play_video") {
          setFocusedElementId(action.element_id);
          setFocusedVideoElementId(action.element_id);
        }
      }
    },
    [executeWhiteboardAction],
  );

  return {
    applyAction,
    focusedElementId,
    focusedVideoElementId,
    activeAudioActionId,
    audioPlaybackToken,
    resetRuntimeSurface,
  };
}
