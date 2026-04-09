"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ActionAckPolicy,
  ChatMessage,
  Lesson,
  LessonAction,
  PlaybackEvent,
  Scene,
  SlideElement,
  StatelessChatRequest,
  TutorStreamEvent,
} from "@ai-tutor/types";
import { Button, Panel, Pill, Shell, Stat } from "@ai-tutor/ui";
import { acknowledgeRuntimeAction, streamLessonPlayback, streamTutorChat } from "../lib/api";
import { WhiteboardCanvas } from "./whiteboard/whiteboard-canvas";
import { useWhiteboardState } from "../hooks/use-whiteboard-state";
import { useRuntimeActionExecutor } from "../hooks/use-runtime-action-executor";

type LessonPlayerShellProps = {
  lesson: Lesson;
  jobStatus?: {
    id: string;
    status: string;
    step: string;
    message: string;
  } | null;
};

type WhiteboardSnapshotHydrator = (
  snapshot: NonNullable<PlaybackEvent["whiteboard_state"]>,
) => void;

export function LessonPlayerShell({ lesson, jobStatus }: LessonPlayerShellProps) {
  const sortedScenes = useMemo(
    () => [...lesson.scenes].sort((left, right) => left.order - right.order),
    [lesson.scenes],
  );
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(
    sortedScenes[0]?.id ?? null,
  );
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [guidedPlaybackEnabled, setGuidedPlaybackEnabled] = useState(false);
  const [discussionPrompt, setDiscussionPrompt] = useState("");
  const [tutorResponse, setTutorResponse] = useState("");
  const [tutorStatus, setTutorStatus] = useState<"idle" | "streaming" | "done" | "error">("idle");
  const [tutorError, setTutorError] = useState<string | null>(null);
  const [tutorSessionId, setTutorSessionId] = useState<string | null>(null);
  const [directorState, setDirectorState] = useState<StatelessChatRequest["director_state"]>(null);
  const [runtimeEvents, setRuntimeEvents] = useState<TutorStreamEvent[]>([]);
  const [playbackEvents, setPlaybackEvents] = useState<PlaybackEvent[]>([]);
  const executedRuntimeActionKeysRef = useRef<Set<string>>(new Set());
  const whiteboard = useWhiteboardState();
  const runtimeExecutor = useRuntimeActionExecutor(whiteboard.executeAction);
  const {
    applyAction: applyRuntimeAction,
    focusedElementId,
    focusedVideoElementId,
    activeAudioActionId,
    audioPlaybackToken,
    resetRuntimeSurface,
  } = runtimeExecutor;

  const selectedScene =
    sortedScenes.find((scene) => scene.id === selectedSceneId) ?? sortedScenes[0] ?? null;
  const selectedSceneIndex = selectedScene
    ? sortedScenes.findIndex((scene) => scene.id === selectedScene.id)
    : -1;
  const selectedAction = selectedScene?.actions[selectedActionIndex] ?? null;
  const actionCount = selectedScene?.actions.length ?? 0;
  const selectedVideoElement = useMemo(
    () => findFocusedVideoElement(selectedScene, selectedAction, focusedVideoElementId),
    [focusedVideoElementId, selectedAction, selectedScene],
  );

  useEffect(() => {
    setSelectedActionIndex(0);
  }, [selectedSceneId]);

  useEffect(() => {
    if (selectedAction?.type.startsWith("whiteboard_")) {
      void applyRuntimeAction(selectedAction);
    }
  }, [applyRuntimeAction, selectedAction]);

  useEffect(() => {
    if (!guidedPlaybackEnabled || selectedAction?.type !== "speech") {
      return;
    }

    void applyRuntimeAction(selectedAction);
  }, [applyRuntimeAction, guidedPlaybackEnabled, selectedAction]);

  useEffect(() => {
    let cancelled = false;

    void streamLessonPlayback(lesson.id, (event) => {
      if (cancelled) {
        return;
      }

      setPlaybackEvents((current) => [...current.slice(-19), event]);

      if (event.kind === "scene_started" && event.scene_id) {
        setSelectedSceneId(event.scene_id);
      }

      if (event.kind === "action_started") {
        if (typeof event.action_index === "number") {
          setSelectedActionIndex(event.action_index);
        }

        if (event.whiteboard_state) {
          whiteboard.hydrateSnapshot(event.whiteboard_state);
        }

        if (event.action_payload) {
          void applyRuntimeAction(event.action_payload, event.execution);
        }
      }
    }).catch(() => {
      // Playback SSE is enhancement-only for now.
    });

    return () => {
      cancelled = true;
    };
  }, [applyRuntimeAction, lesson.id, whiteboard.hydrateSnapshot]);

  useEffect(() => {
    if (selectedAction?.type === "discussion") {
      return;
    }

    setRuntimeEvents([]);
    resetRuntimeSurface();
  }, [resetRuntimeSurface, selectedAction?.id, selectedAction?.type]);

  function jumpToScene(nextIndex: number) {
    const scene = sortedScenes[nextIndex];
    if (!scene) {
      return;
    }

    setSelectedSceneId(scene.id);
  }

  function jumpToAction(nextIndex: number) {
    if (!selectedScene) {
      return;
    }

    const clamped = Math.max(0, Math.min(nextIndex, selectedScene.actions.length - 1));
    setSelectedActionIndex(clamped);
  }

  function advancePlaybackStep() {
    if (!selectedScene) {
      return;
    }

    if (selectedActionIndex < selectedScene.actions.length - 1) {
      setSelectedActionIndex((current) => current + 1);
      return;
    }

    const nextScene = sortedScenes[selectedSceneIndex + 1];
    if (nextScene) {
      setSelectedSceneId(nextScene.id);
      setSelectedActionIndex(0);
    }
  }

  return (
    <Shell>
      <main className="lesson-shell">
        <section className="lesson-stage">
          <Panel eyebrow="Lesson Player" title={lesson.title}>
            <div className="stats-grid">
              <Stat label="Scenes" value={lesson.scenes.length} />
              <Stat label="Language" value={lesson.language} />
              <Stat label="Style" value={lesson.style ?? "interactive"} />
              <Stat
                label="Current Scene"
                value={
                  selectedSceneIndex >= 0
                    ? `${selectedSceneIndex + 1} / ${sortedScenes.length}`
                    : "none"
                }
              />
              <Stat
                label="Job"
                value={jobStatus ? `${jobStatus.status} / ${jobStatus.step}` : "not loaded"}
              />
            </div>

            {lesson.description ? <p className="lesson-description">{lesson.description}</p> : null}

            <div className="player-toolbar">
              <Button
                disabled={selectedSceneIndex <= 0}
                onClick={() => jumpToScene(selectedSceneIndex - 1)}
                type="button"
              >
                Previous scene
              </Button>
              <Button
                disabled={
                  selectedSceneIndex < 0 || selectedSceneIndex >= sortedScenes.length - 1
                }
                onClick={() => jumpToScene(selectedSceneIndex + 1)}
                type="button"
              >
                Next scene
              </Button>
            </div>
          </Panel>

          {selectedScene ? (
            <>
              <PlaybackPanel
                action={selectedAction}
                actionCount={actionCount}
                actionIndex={selectedActionIndex}
                playbackEvents={playbackEvents}
                focusedVideoElementId={selectedVideoElement?.id ?? null}
                guidedPlaybackEnabled={guidedPlaybackEnabled}
                onToggleGuidedPlayback={() =>
                  setGuidedPlaybackEnabled((current) => !current)
                }
                onPlayAudio={() => {
                  if (selectedAction) {
                    void applyRuntimeAction(selectedAction);
                  }
                }}
                onNextAction={() => jumpToAction(selectedActionIndex + 1)}
                onPreviousAction={() => jumpToAction(selectedActionIndex - 1)}
                scene={selectedScene}
              />
              <ActionSurface action={selectedAction} scene={selectedScene} />
              {selectedAction?.type === "discussion" ? (
                <TutorDiscussionPanel
                  directorState={directorState}
                  error={tutorError}
                  lesson={lesson}
                  prompt={discussionPrompt}
                  response={tutorResponse}
                  runtimeEvents={runtimeEvents}
                  scene={selectedScene}
                  status={tutorStatus}
                  topic={selectedAction.topic}
                  onPromptChange={setDiscussionPrompt}
                  onSubmit={async () => {
                    const trimmedPrompt = discussionPrompt.trim();
                    if (!trimmedPrompt) {
                      return;
                    }

                    setTutorStatus("streaming");
                    setTutorError(null);
                    setTutorResponse("");
                    setRuntimeEvents([]);
                    executedRuntimeActionKeysRef.current.clear();
                    resetRuntimeSurface();

                    const payload = buildTutorPayload(
                      lesson,
                      selectedScene,
                      selectedAction.topic,
                      trimmedPrompt,
                      directorState,
                      tutorSessionId,
                    );

                    try {
                      await streamTutorChat(payload, (event) => {
                        handleTutorEvent(
                          event,
                          {
                            setTutorResponse,
                            setTutorStatus,
                            setDirectorState,
                            setTutorSessionId,
                            setRuntimeEvents,
                            hydrateWhiteboardSnapshot: whiteboard.hydrateSnapshot,
                            resetRuntimeSurface,
                            markRuntimeActionExecution: (
                              key: string,
                              eventKind: TutorStreamEvent["kind"],
                            ) => {
                              const seen = executedRuntimeActionKeysRef.current.has(key);
                              if (eventKind === "action_started") {
                                if (seen) {
                                  return false;
                                }
                                executedRuntimeActionKeysRef.current.add(key);
                                return true;
                              }
                              if (eventKind === "action_completed") {
                                if (seen) {
                                  return false;
                                }
                                // Fallback path for providers that only emit completed.
                                executedRuntimeActionKeysRef.current.add(key);
                                return true;
                              }
                              return false;
                            },
                          },
                          applyRuntimeAction,
                        );
                      });
                    } catch (error) {
                      setTutorStatus("error");
                      setTutorError(error instanceof Error ? error.message : String(error));
                    }
                  }}
                />
              ) : null}
              <ScenePanel
                audioPlaybackActionId={activeAudioActionId}
                audioPlaybackToken={audioPlaybackToken}
                guidedPlaybackEnabled={guidedPlaybackEnabled}
                onAdvanceAfterAudio={advancePlaybackStep}
                onAdvanceAfterVideo={advancePlaybackStep}
                runtimeFocusedSpotlightElementId={focusedElementId}
                runtimeFocusedVideoElementId={focusedVideoElementId}
                scene={selectedScene}
                selectedAction={selectedAction}
                whiteboardEnabled={whiteboard.isOpen}
                whiteboardElements={whiteboard.elements}
                whiteboardIsClearing={whiteboard.isClearing}
              />
            </>
          ) : null}
        </section>

        <aside className="lesson-sidebar">
          <Panel eyebrow="Scene Flow" title="Scene Navigator">
            <div className="scene-list">
              {sortedScenes.map((scene) => (
                <button
                  key={scene.id}
                  className={`scene-item ${
                    selectedScene?.id === scene.id ? "scene-item-active" : ""
                  }`}
                  onClick={() => setSelectedSceneId(scene.id)}
                  type="button"
                >
                  <span>
                    {scene.order}. {scene.title}
                  </span>
                  <Pill>{scene.content.type}</Pill>
                </button>
              ))}
            </div>
          </Panel>

          <Panel eyebrow="Job Snapshot" title="Backend Status">
            {jobStatus ? (
              <div className="job-card">
                <Pill tone={jobStatus.status === "succeeded" ? "success" : "warning"}>
                  {jobStatus.status}
                </Pill>
                <p>Step: {jobStatus.step}</p>
                <p>{jobStatus.message}</p>
              </div>
            ) : (
              <p className="muted-text">Job status was not requested for this lesson view.</p>
            )}
          </Panel>

          <Panel eyebrow="Playback Model" title="Action Timeline">
            {selectedScene ? (
              <div className="timeline-list">
                {selectedScene.actions.map((action, index) => (
                  <button
                    key={action.id}
                    className={`timeline-item ${
                      selectedAction?.id === action.id ? "timeline-item-active" : ""
                    }`}
                    onClick={() => setSelectedActionIndex(index)}
                    type="button"
                  >
                    <span className="timeline-index">{index + 1}</span>
                    <div className="timeline-copy">
                      <strong>{action.type}</strong>
                      <p>{summarizeAction(action)}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted-text">No scene selected.</p>
            )}
          </Panel>
        </aside>
      </main>
    </Shell>
  );
}

function PlaybackPanel({
  scene,
  action,
  actionCount,
  actionIndex,
  playbackEvents,
  focusedVideoElementId,
  guidedPlaybackEnabled,
  onPreviousAction,
  onNextAction,
  onPlayAudio,
  onToggleGuidedPlayback,
}: {
  scene: Scene;
  action: LessonAction | null;
  actionCount: number;
  actionIndex: number;
  playbackEvents: PlaybackEvent[];
  focusedVideoElementId: string | null;
  guidedPlaybackEnabled: boolean;
  onPreviousAction: () => void;
  onNextAction: () => void;
  onPlayAudio: () => void;
  onToggleGuidedPlayback: () => void;
}) {
  const progress =
    actionCount > 0 ? Math.round(((actionIndex + 1) / actionCount) * 100) : 0;

  return (
    <Panel eyebrow="Playback Shell" title="Action-aware player state">
      <div className="stats-grid">
        <Stat label="Scene" value={scene.title} />
        <Stat label="Action Step" value={actionCount > 0 ? `${actionIndex + 1} / ${actionCount}` : "0 / 0"} />
        <Stat label="Scene Type" value={scene.content.type} />
        <Stat
          label="Media"
          value={scene.content.type === "slide" ? countSlideMedia(scene) : "n/a"}
        />
        <Stat label="Guided Mode" value={guidedPlaybackEnabled ? "on" : "off"} />
        <Stat
          label="Focused Video"
          value={focusedVideoElementId ?? "none"}
        />
        <Stat
          label="Playback Events"
          value={playbackEvents.length > 0 ? playbackEvents.length : "none"}
        />
      </div>

      <div className="playback-progress">
        <div className="playback-progress-bar" style={{ width: `${progress}%` }} />
      </div>

      {action ? (
        <div className="active-action-card">
          <Pill tone="warning">Current action</Pill>
          <h3>{action.type}</h3>
          <p>{summarizeAction(action)}</p>
        </div>
      ) : (
        <p className="muted-text">
          This scene has no actions yet. The playback runtime will attach here later.
        </p>
      )}

      <div className="player-toolbar">
        <Button disabled={actionIndex <= 0 || actionCount === 0} onClick={onPreviousAction} type="button">
          Previous action
        </Button>
        <Button
          disabled={!(action?.type === "speech" && action.audio_url)}
          onClick={onPlayAudio}
          type="button"
        >
          Play teacher audio
        </Button>
        <Button onClick={onToggleGuidedPlayback} type="button">
          {guidedPlaybackEnabled ? "Stop guided mode" : "Start guided mode"}
        </Button>
        <Button
          disabled={actionCount === 0 || actionIndex >= actionCount - 1}
          onClick={onNextAction}
          type="button"
        >
          Next action
        </Button>
      </div>
      {playbackEvents.length > 0 ? (
        <p className="muted-text">
          Latest playback event: {playbackEvents[playbackEvents.length - 1]?.summary}
        </p>
      ) : null}
    </Panel>
  );
}

function ActionSurface({
  action,
  scene,
}: {
  action: LessonAction | null;
  scene: Scene;
}) {
  if (!action) {
    return null;
  }

  if (action.type === "speech") {
    return (
      <Panel eyebrow="Teacher Voice Shell" title="Narration">
        <div className="narration-card">
          <Pill tone="success">Speech</Pill>
          <blockquote className="narration-quote">{action.text}</blockquote>
          {action.audio_url ? (
            <div className="audio-slot-card">
              <p className="audio-slot-label">Generated audio attached</p>
              <audio controls preload="none" src={action.audio_url}>
                Your browser does not support audio playback.
              </audio>
            </div>
          ) : (
            <p className="muted-text">
              This is the future handoff point for generated teacher audio and playback controls.
            </p>
          )}
        </div>
      </Panel>
    );
  }

  if (action.type === "discussion") {
    return (
      <Panel eyebrow="Discussion Shell" title="Tutor Prompt">
        <div className="discussion-card">
          <Pill tone="warning">Discussion</Pill>
          <h3>{action.topic}</h3>
          <p className="muted-text">
            The stateless tutor stream now attaches here for scene <strong>{scene.title}</strong>.
          </p>
          <div className="discussion-actions">
            <Button disabled type="button">
              Ask by voice
            </Button>
            <Button disabled type="button">
              Multi-agent mode later
            </Button>
          </div>
        </div>
      </Panel>
    );
  }

  if (action.type === "spotlight") {
    return (
      <Panel eyebrow="Stage Focus" title="Spotlight Target">
        <div className="spotlight-card">
          <Pill tone="warning">Spotlight</Pill>
          <p>
            The active teaching focus is element <code>{action.element_id}</code>. Matching slide
            elements are highlighted inside the scene canvas.
          </p>
        </div>
      </Panel>
    );
  }

  return null;
}

function ScenePanel({
  scene,
  selectedAction,
  audioPlaybackActionId,
  audioPlaybackToken,
  guidedPlaybackEnabled,
  onAdvanceAfterAudio,
  onAdvanceAfterVideo,
  runtimeFocusedSpotlightElementId,
  runtimeFocusedVideoElementId,
  whiteboardEnabled,
  whiteboardElements,
  whiteboardIsClearing,
}: {
  scene: Scene;
  selectedAction: LessonAction | null;
  audioPlaybackActionId: string | null;
  audioPlaybackToken: number;
  guidedPlaybackEnabled: boolean;
  onAdvanceAfterAudio: () => void;
  onAdvanceAfterVideo: () => void;
  runtimeFocusedSpotlightElementId?: string | null;
  runtimeFocusedVideoElementId?: string | null;
  whiteboardEnabled?: boolean;
  whiteboardElements?: LessonAction[];
  whiteboardIsClearing?: boolean;
}) {
  if (scene.content.type === "slide") {
    const focusedVideoElement = findFocusedVideoElement(
      scene,
      selectedAction,
      runtimeFocusedVideoElementId,
    );

    return (
      <Panel eyebrow="Slide Scene" title={scene.title}>
        <div className="slide-canvas relative">
          {scene.content.canvas.elements.map((element) => (
            <div
              key={element.id}
              className={`slide-element ${
                resolveFocusedElementId(selectedAction, runtimeFocusedSpotlightElementId) ===
                element.id
                  ? "slide-element-active"
                  : ""
              }`}
            >
              <div className="slide-element-head">
                <strong>{element.kind}</strong>
                <code>{element.id}</code>
              </div>
              {renderSlideElement(element)}
            </div>
          ))}
          {whiteboardEnabled && whiteboardElements ? (
            <div className="absolute inset-0 z-50 pointer-events-auto">
              <WhiteboardCanvas
                elements={whiteboardElements}
                isClearing={whiteboardIsClearing ?? false}
              />
            </div>
          ) : null}
        </div>
        {selectedAction?.type === "speech" ? (
          <InlineAudioDock
            action={selectedAction}
            audioPlaybackActionId={audioPlaybackActionId}
            audioPlaybackToken={audioPlaybackToken}
            guidedPlaybackEnabled={guidedPlaybackEnabled}
            onAdvanceAfterAudio={onAdvanceAfterAudio}
          />
        ) : null}
        {focusedVideoElement ? (
          <FocusedVideoDock
            guidedPlaybackEnabled={guidedPlaybackEnabled}
            onAdvanceAfterVideo={onAdvanceAfterVideo}
            videoElement={focusedVideoElement}
          />
        ) : null}
        <ActionList scene={scene} selectedActionId={selectedAction?.id ?? null} />
      </Panel>
    );
  }

  if (scene.content.type === "quiz") {
    return (
      <Panel eyebrow="Quiz Scene" title={scene.title}>
        <div className="quiz-list">
          {scene.content.questions.map((question) => (
            <article key={question.id} className="quiz-card">
              <h3>{question.question}</h3>
              {question.options?.length ? (
                <ul className="plain-list">
                  {question.options.map((option) => (
                    <li key={option.value}>
                      {option.value}. {option.label}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
        <ActionList scene={scene} selectedActionId={selectedAction?.id ?? null} />
      </Panel>
    );
  }

  return (
    <Panel eyebrow="Future Scene Type" title={scene.title}>
      <p className="muted-text">
        This scene type is stored and reachable, but its dedicated player UI is not built yet.
      </p>
      <pre className="code-block">{JSON.stringify(scene.content, null, 2)}</pre>
      <ActionList scene={scene} selectedActionId={selectedAction?.id ?? null} />
    </Panel>
  );
}

function InlineAudioDock({
  action,
  audioPlaybackActionId,
  audioPlaybackToken,
  guidedPlaybackEnabled,
  onAdvanceAfterAudio,
}: {
  action: Extract<LessonAction, { type: "speech" }>;
  audioPlaybackActionId: string | null;
  audioPlaybackToken: number;
  guidedPlaybackEnabled: boolean;
  onAdvanceAfterAudio: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (
      !audioRef.current ||
      !action.audio_url ||
      audioPlaybackToken === 0 ||
      audioPlaybackActionId !== action.id
    ) {
      return;
    }

    audioRef.current.currentTime = 0;
    void audioRef.current.play().catch(() => {
      // Browser autoplay rules may still block playback.
    });
  }, [action.audio_url, action.id, audioPlaybackActionId, audioPlaybackToken]);

  if (!action.audio_url) {
    return null;
  }

  return (
    <div className="audio-dock-card">
      <div className="audio-dock-copy">
        <Pill tone="success">Audio Dock</Pill>
        <p className="muted-text">
          Current narration audio is ready for guided playback.
          {guidedPlaybackEnabled ? " Guided mode will advance after this clip ends." : ""}
        </p>
      </div>
      <audio
        controls
        onEnded={() => {
          if (guidedPlaybackEnabled) {
            onAdvanceAfterAudio();
          }
        }}
        preload="metadata"
        ref={audioRef}
        src={action.audio_url}
      >
        Your browser does not support audio playback.
      </audio>
    </div>
  );
}

function FocusedVideoDock({
  videoElement,
  guidedPlaybackEnabled,
  onAdvanceAfterVideo,
}: {
  videoElement: Extract<SlideElement, { kind: "video" }>;
  guidedPlaybackEnabled: boolean;
  onAdvanceAfterVideo: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoRef.current || !guidedPlaybackEnabled) {
      return;
    }

    videoRef.current.currentTime = 0;
    void videoRef.current.play().catch(() => {
      // Browser autoplay rules may still block playback.
    });
  }, [guidedPlaybackEnabled, videoElement.id, videoElement.src]);

  return (
    <div className="video-dock-card">
      <div className="video-dock-copy">
        <Pill tone="warning">Video Focus</Pill>
        <p className="muted-text">
          Focused slide video <code>{videoElement.id}</code> is ready.
          {guidedPlaybackEnabled ? " Guided mode will advance when this clip ends." : ""}
        </p>
      </div>
      <video
        className="slide-media"
        controls
        onEnded={() => {
          if (guidedPlaybackEnabled) {
            onAdvanceAfterVideo();
          }
        }}
        preload="metadata"
        ref={videoRef}
        src={videoElement.src}
      />
    </div>
  );
}

function renderSlideElement(element: SlideElement) {
  if (element.kind === "text") {
    return <p>{element.content}</p>;
  }

  if (element.kind === "image") {
    return (
      <div className="slide-media-stack">
        <img alt="" className="slide-media" loading="lazy" src={element.src} />
        <p className="slide-media-meta">{element.src}</p>
      </div>
    );
  }

  return (
    <div className="slide-media-stack">
      <video className="slide-media" controls preload="metadata" src={element.src} />
      <p className="slide-media-meta">{element.src}</p>
    </div>
  );
}

function countSlideMedia(scene: Scene) {
  if (scene.content.type !== "slide") {
    return "0";
  }

  return scene.content.canvas.elements.filter(
    (element) => element.kind === "image" || element.kind === "video",
  ).length.toString();
}

function findFocusedVideoElement(
  scene: Scene | null,
  action: LessonAction | null,
  runtimeFocusedVideoElementId?: string | null,
) {
  if (!scene || scene.content.type !== "slide") {
    return null;
  }

  const videoElements = scene.content.canvas.elements.filter(
    (element): element is Extract<SlideElement, { kind: "video" }> => element.kind === "video",
  );

  if (videoElements.length === 0) {
    return null;
  }

  if (runtimeFocusedVideoElementId) {
    return (
      videoElements.find((element) => element.id === runtimeFocusedVideoElementId) ??
      videoElements[0]
    );
  }

  if (action?.type === "spotlight") {
    return videoElements.find((element) => element.id === action.element_id) ?? videoElements[0];
  }

  return videoElements[0];
}

function resolveFocusedElementId(
  action: LessonAction | null,
  runtimeFocusedSpotlightElementId?: string | null,
) {
  if (runtimeFocusedSpotlightElementId) {
    return runtimeFocusedSpotlightElementId;
  }

  if (
    action &&
    (action.type === "spotlight" || action.type === "laser" || action.type === "play_video")
  ) {
    return action.element_id;
  }

  return null;
}

function ActionList({
  scene,
  selectedActionId,
}: {
  scene: Scene;
  selectedActionId: string | null;
}) {
  return (
    <div className="action-list">
      <h3>Scene actions</h3>
      <ul className="plain-list action-items">
        {scene.actions.map((action) => (
          <li
            key={action.id}
            className={selectedActionId === action.id ? "action-item-active" : undefined}
          >
            <code>{action.type}</code>
            {`: ${summarizeAction(action)}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TutorDiscussionPanel({
  lesson,
  scene,
  topic,
  prompt,
  response,
  error,
  runtimeEvents,
  status,
  directorState,
  onPromptChange,
  onSubmit,
}: {
  lesson: Lesson;
  scene: Scene;
  topic: string;
  prompt: string;
  response: string;
  error: string | null;
  runtimeEvents: TutorStreamEvent[];
  status: "idle" | "streaming" | "done" | "error";
  directorState: StatelessChatRequest["director_state"];
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Panel eyebrow="Tutor Stream" title="Live Tutor Response">
      <div className="discussion-stream-card">
        <div className="discussion-stream-head">
          <Pill tone={status === "error" ? "warning" : "success"}>{status}</Pill>
          <span className="muted-text">Topic: {topic}</span>
        </div>
        <textarea
          className="discussion-input"
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="Ask the tutor to explain this scene, simplify it, or answer a question."
          rows={4}
          value={prompt}
        />
        <div className="discussion-actions">
          <Button disabled={status === "streaming" || prompt.trim().length === 0} onClick={onSubmit} type="button">
            {status === "streaming" ? "Streaming..." : "Ask tutor"}
          </Button>
        </div>
        <div className="discussion-response">
          <strong>Streamed answer</strong>
          <p>{response || "No streamed tutor response yet."}</p>
        </div>
        {error ? (
          <div className="discussion-response">
            <strong>Runtime error</strong>
            <p>{error}</p>
          </div>
        ) : null}
        <div className="discussion-response">
          <strong>Turn memory</strong>
          <p>
            {directorState
              ? `${directorState.turn_count} tutor turn(s) stored for lesson ${lesson.title} / scene ${scene.title}.`
              : "No director state has been returned yet."}
          </p>
        </div>
        <div className="discussion-response">
          <strong>Runtime events</strong>
          <p>
            {runtimeEvents.length > 0
              ? runtimeEvents
                  .slice(-4)
                  .map((event) => summarizeTutorRuntimeEvent(event))
                  .join(" • ")
              : "No streamed runtime actions yet."}
          </p>
        </div>
      </div>
    </Panel>
  );
}

function buildTutorPayload(
  lesson: Lesson,
  scene: Scene,
  topic: string,
  prompt: string,
  directorState: StatelessChatRequest["director_state"],
  sessionId: string | null,
): StatelessChatRequest {
  const messages: ChatMessage[] = [
    {
      id: `user-${Date.now()}`,
      role: "user",
      content: prompt,
    },
  ];

  return {
    session_id: sessionId,
    runtime_session: {
      mode: "stateless_client_state",
    },
    messages,
    store_state: {
      stage: null,
      scenes: lesson.scenes,
      current_scene_id: scene.id,
      mode: "live",
      whiteboard_open: false,
    },
    config: {
      agent_ids: ["assistant"],
      session_type: "discussion",
      discussion_topic: topic,
      discussion_prompt: prompt,
      trigger_agent_id: "assistant",
      agent_configs: [
        {
          id: "assistant",
          name: "AI Tutor",
          role: "teacher",
          persona: "Supportive classroom tutor",
          avatar: "teacher",
          color: "#21614e",
          allowed_actions: [
            "speech",
            "discussion",
            "spotlight",
            "laser",
            "play_video",
            "whiteboard",
          ],
          priority: 1,
          is_generated: true,
          bound_stage_id: scene.stage_id,
        },
      ],
    },
    director_state: directorState ?? null,
    user_profile: null,
    api_key: "server-managed",
    model: "openai:gpt-4o-mini",
    provider_type: "openai",
    requires_api_key: false,
    base_url: null,
  };
}

function handleTutorEvent(
  event: TutorStreamEvent,
  handlers: {
    setTutorResponse: React.Dispatch<React.SetStateAction<string>>;
    setTutorStatus: React.Dispatch<React.SetStateAction<"idle" | "streaming" | "done" | "error">>;
    setDirectorState: React.Dispatch<React.SetStateAction<StatelessChatRequest["director_state"]>>;
    setTutorSessionId: React.Dispatch<React.SetStateAction<string | null>>;
    setRuntimeEvents: React.Dispatch<React.SetStateAction<TutorStreamEvent[]>>;
    hydrateWhiteboardSnapshot: WhiteboardSnapshotHydrator;
    resetRuntimeSurface: () => void;
    markRuntimeActionExecution: (
      key: string,
      eventKind: TutorStreamEvent["kind"],
    ) => boolean;
  },
  applyRuntimeAction: (
    action: LessonAction,
    execution?: TutorStreamEvent["execution"],
  ) => Promise<void>,
) {
  handlers.setTutorSessionId(event.session_id);
  handlers.setRuntimeEvents((current) => [...current.slice(-11), event]);

  if (event.kind === "text_delta" && event.content) {
    handlers.setTutorResponse((current) => `${current}${event.content}`);
    return;
  }

  if (event.kind === "action_started" || event.kind === "action_completed") {
    if (event.whiteboard_state) {
      handlers.hydrateWhiteboardSnapshot(event.whiteboard_state);
    }
    const runtimeAction = buildRuntimeLessonAction(event);

    if (!runtimeAction) {
      return;
    }

    const executionKey = buildRuntimeActionExecutionKey(event, runtimeAction);
    if (!handlers.markRuntimeActionExecution(executionKey, event.kind)) {
      return;
    }

    void applyRuntimeAction(runtimeAction, event.execution)
      .then(() =>
        acknowledgeRuntimeAction({
          session_id: event.session_id,
          runtime_session_id: event.runtime_session_id ?? event.session_id,
          runtime_session_mode: event.runtime_session_mode ?? null,
          execution_id: event.execution_id ?? executionKey,
          action_name: event.action_name ?? null,
          status: event.kind === "action_started" ? "accepted" : "completed",
          error: null,
        }).catch(() => undefined),
      )
      .catch((error) =>
        acknowledgeRuntimeAction({
          session_id: event.session_id,
          runtime_session_id: event.runtime_session_id ?? event.session_id,
          runtime_session_mode: event.runtime_session_mode ?? null,
          execution_id: event.execution_id ?? executionKey,
          action_name: event.action_name ?? null,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined),
      );
    return;
  }

  if (event.kind === "interrupted") {
    if (event.director_state?.whiteboard_state) {
      handlers.hydrateWhiteboardSnapshot(event.director_state.whiteboard_state);
    }
    handlers.resetRuntimeSurface();
    handlers.setTutorStatus("done");
    handlers.setDirectorState(event.director_state ?? null);
    return;
  }

  if (event.kind === "done") {
    if (event.director_state?.whiteboard_state) {
      handlers.hydrateWhiteboardSnapshot(event.director_state.whiteboard_state);
    }
    handlers.setTutorStatus("done");
    handlers.setDirectorState(event.director_state ?? null);
    return;
  }

  if (event.kind === "error") {
    handlers.setTutorStatus("error");
  }
}

function buildRuntimeLessonAction(event: TutorStreamEvent): LessonAction | null {
  if (
    (event.kind !== "action_started" && event.kind !== "action_completed") ||
    !event.action_name
  ) {
    return null;
  }

  const params: Record<string, unknown> = event.action_params ?? {};
  const id = `${event.session_id}-${event.action_name}-${Date.now()}`;
  if (isCanonicalRuntimeActionPayload(params)) {
    return buildRuntimeLessonActionFromCanonicalPayload(params, event.action_name, id);
  }
  const pickParam = (keys: string[]) => {
    for (const key of keys) {
      const value = params[key];
      if (value !== undefined && value !== null) {
        return value;
      }
    }
    return undefined;
  };
  const stringParam = (...keys: string[]) => {
    const value = pickParam(keys);
    return typeof value === "string" ? value : undefined;
  };
  const numberParam = (...keys: string[]) => {
    const value = pickParam(keys);
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  };
  const stringArrayParam = (...keys: string[]) => {
    const value = pickParam(keys);
    if (!Array.isArray(value)) {
      return undefined;
    }
    return value.filter((item): item is string => typeof item === "string");
  };
  const numberMatrixParam = (...keys: string[]) => {
    const value = pickParam(keys);
    if (!Array.isArray(value)) {
      return undefined;
    }
    return value
      .map((row) => (Array.isArray(row) ? row.filter((cell) => typeof cell === "number") : []))
      .filter((row): row is number[] => row.length > 0);
  };
  const objectParam = (...keys: string[]) => {
    const value = pickParam(keys);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  };

  switch (event.action_name) {
    case "spotlight":
      return stringParam("elementId", "element_id")
        ? { type: "spotlight", id, element_id: stringParam("elementId", "element_id")! }
        : null;
    case "laser":
      return stringParam("elementId", "element_id")
        ? {
            type: "laser",
            id,
            element_id: stringParam("elementId", "element_id")!,
            color: stringParam("color", "laser_color") ?? null,
          }
        : null;
    case "play_video":
      return stringParam("elementId", "element_id")
        ? { type: "play_video", id, element_id: stringParam("elementId", "element_id")! }
        : null;
    case "wb_open":
      return { type: "whiteboard_open", id };
    case "wb_close":
      return { type: "whiteboard_close", id };
    case "wb_clear":
      return { type: "whiteboard_clear", id };
    case "wb_delete":
      return stringParam("elementId", "element_id")
        ? { type: "whiteboard_delete", id, element_id: stringParam("elementId", "element_id")! }
        : null;
    case "wb_draw_text":
      return {
        type: "whiteboard_draw_text",
        id,
        element_id: stringParam("elementId", "element_id", "id") ?? null,
        content: stringParam("content", "text") ?? "",
        x: numberParam("x") ?? 0,
        y: numberParam("y") ?? 0,
        width: numberParam("width") ?? null,
        height: numberParam("height") ?? null,
        font_size: numberParam("fontSize", "font_size") ?? null,
        color: stringParam("color") ?? null,
      };
    case "wb_draw_shape":
      return {
        type: "whiteboard_draw_shape",
        id,
        element_id: stringParam("elementId", "element_id", "id") ?? null,
        shape:
          (stringParam("shape") as "rectangle" | "circle" | "triangle" | undefined) ??
          "rectangle",
        x: numberParam("x") ?? 0,
        y: numberParam("y") ?? 0,
        width: numberParam("width") ?? 0,
        height: numberParam("height") ?? 0,
        fill_color: stringParam("fillColor", "fill_color", "fill") ?? null,
      };
    case "wb_draw_chart":
      return {
        type: "whiteboard_draw_chart",
        id,
        element_id: stringParam("elementId", "element_id", "id") ?? null,
        chart_type: stringParam("chartType", "chart_type") ?? "bar",
        x: numberParam("x") ?? 0,
        y: numberParam("y") ?? 0,
        width: numberParam("width") ?? 0,
        height: numberParam("height") ?? 0,
        data: {
          labels: stringArrayParam("labels") ?? [],
          legends: stringArrayParam("legends") ?? [],
          series: numberMatrixParam("series") ?? [],
        },
        theme_colors: stringArrayParam("themeColors", "theme_colors") ?? null,
      };
    case "wb_draw_latex":
      return {
        type: "whiteboard_draw_latex",
        id,
        element_id: stringParam("elementId", "element_id", "id") ?? null,
        latex: stringParam("latex") ?? "",
        x: numberParam("x") ?? 0,
        y: numberParam("y") ?? 0,
        width: numberParam("width") ?? null,
        height: numberParam("height") ?? null,
        color: stringParam("color") ?? null,
      };
    case "wb_draw_table":
      {
        const outline = objectParam("outline");
        const theme = objectParam("theme");
        return {
          type: "whiteboard_draw_table",
          id,
          element_id: stringParam("elementId", "element_id", "id") ?? null,
          x: numberParam("x") ?? 0,
          y: numberParam("y") ?? 0,
          width: numberParam("width") ?? 0,
          height: numberParam("height") ?? 0,
          data: Array.isArray(params.data) ? (params.data as string[][]) : [],
          outline: outline
            ? {
                width: numberParam("outlineWidth") ?? (typeof outline.width === "number" ? outline.width : 1),
                style:
                  stringParam("outlineStyle") ??
                  (typeof outline.style === "string" ? outline.style : "solid"),
                color:
                  stringParam("outlineColor") ??
                  (typeof outline.color === "string" ? outline.color : "#cccccc"),
              }
            : null,
          theme: theme
            ? {
                color:
                  stringParam("themeColor") ??
                  (typeof theme.color === "string" ? theme.color : "#000000"),
              }
            : null,
        };
      }
    case "wb_draw_line":
      {
        const points = stringArrayParam("points");
        const resolvedPoints =
          points && points.length >= 2 ? ([points[0], points[1]] as [string, string]) : null;
        return {
          type: "whiteboard_draw_line",
          id,
          element_id: stringParam("elementId", "element_id", "id") ?? null,
          start_x: numberParam("startX", "start_x") ?? 0,
          start_y: numberParam("startY", "start_y") ?? 0,
          end_x: numberParam("endX", "end_x") ?? 0,
          end_y: numberParam("endY", "end_y") ?? 0,
          color: stringParam("color") ?? null,
          width: numberParam("width", "strokeWidth", "stroke_width") ?? null,
          style:
            (stringParam("style", "lineStyle") as "solid" | "dashed" | undefined) ?? null,
          points: resolvedPoints,
        };
      }
    default:
      return null;
  }
}

function isCanonicalRuntimeActionPayload(
  value: Record<string, unknown>,
): value is Record<string, unknown> & { schema_version: "runtime_action_v1"; action_name: string } {
  return (
    value.schema_version === "runtime_action_v1" &&
    typeof value.action_name === "string" &&
    value.action_name.length > 0
  );
}

function buildRuntimeLessonActionFromCanonicalPayload(
  payload: Record<string, unknown> & { action_name: string },
  fallbackActionName: string | null | undefined,
  id: string,
): LessonAction | null {
  const actionName = payload.action_name || fallbackActionName;
  if (!actionName) {
    return null;
  }

  const pickParam = (...keys: string[]) => {
    for (const key of keys) {
      const value = payload[key];
      if (value !== undefined && value !== null) {
        return value;
      }
    }
    return undefined;
  };
  const stringParam = (...keys: string[]) => {
    const value = pickParam(...keys);
    return typeof value === "string" ? value : undefined;
  };
  const numberParam = (...keys: string[]) => {
    const value = pickParam(...keys);
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  };
  const stringArrayParam = (...keys: string[]) => {
    const value = pickParam(...keys);
    if (!Array.isArray(value)) {
      return undefined;
    }
    return value.filter((item): item is string => typeof item === "string");
  };
  const numberMatrixParam = (...keys: string[]) => {
    const value = pickParam(...keys);
    if (!Array.isArray(value)) {
      return undefined;
    }
    return value
      .map((row) => (Array.isArray(row) ? row.filter((cell) => typeof cell === "number") : []))
      .filter((row): row is number[] => row.length > 0);
  };
  const objectParam = (...keys: string[]) => {
    const value = pickParam(...keys);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  };

  switch (actionName) {
    case "spotlight":
      return stringParam("elementId", "element_id")
        ? { type: "spotlight", id, element_id: stringParam("elementId", "element_id")! }
        : null;
    case "laser":
      return stringParam("elementId", "element_id")
        ? {
            type: "laser",
            id,
            element_id: stringParam("elementId", "element_id")!,
            color: stringParam("color") ?? null,
          }
        : null;
    case "play_video":
      return stringParam("elementId", "element_id")
        ? { type: "play_video", id, element_id: stringParam("elementId", "element_id")! }
        : null;
    case "wb_open":
      return { type: "whiteboard_open", id };
    case "wb_close":
      return { type: "whiteboard_close", id };
    case "wb_clear":
      return { type: "whiteboard_clear", id };
    case "wb_delete":
      return stringParam("elementId", "element_id")
        ? { type: "whiteboard_delete", id, element_id: stringParam("elementId", "element_id")! }
        : null;
    case "wb_draw_text":
      return {
        type: "whiteboard_draw_text",
        id,
        element_id: stringParam("elementId", "element_id") ?? null,
        content: stringParam("content", "text") ?? "",
        x: numberParam("x") ?? 0,
        y: numberParam("y") ?? 0,
        width: numberParam("width") ?? null,
        height: numberParam("height") ?? null,
        font_size: numberParam("fontSize", "font_size") ?? null,
        color: stringParam("color") ?? null,
      };
    case "wb_draw_shape":
      return {
        type: "whiteboard_draw_shape",
        id,
        element_id: stringParam("elementId", "element_id") ?? null,
        shape:
          (stringParam("shape") as "rectangle" | "circle" | "triangle" | undefined) ??
          "rectangle",
        x: numberParam("x") ?? 0,
        y: numberParam("y") ?? 0,
        width: numberParam("width") ?? 0,
        height: numberParam("height") ?? 0,
        fill_color: stringParam("fillColor", "fill_color", "fill") ?? null,
      };
    case "wb_draw_chart":
      return {
        type: "whiteboard_draw_chart",
        id,
        element_id: stringParam("elementId", "element_id") ?? null,
        chart_type: stringParam("chartType", "chart_type") ?? "bar",
        x: numberParam("x") ?? 0,
        y: numberParam("y") ?? 0,
        width: numberParam("width") ?? 0,
        height: numberParam("height") ?? 0,
        data: {
          labels: stringArrayParam("labels") ?? [],
          legends: stringArrayParam("legends") ?? [],
          series: numberMatrixParam("series") ?? [],
        },
        theme_colors: stringArrayParam("themeColors", "theme_colors") ?? null,
      };
    case "wb_draw_latex":
      return {
        type: "whiteboard_draw_latex",
        id,
        element_id: stringParam("elementId", "element_id") ?? null,
        latex: stringParam("latex") ?? "",
        x: numberParam("x") ?? 0,
        y: numberParam("y") ?? 0,
        width: numberParam("width") ?? null,
        height: numberParam("height") ?? null,
        color: stringParam("color") ?? null,
      };
    case "wb_draw_table":
      {
        const outline = objectParam("outline");
        const theme = objectParam("theme");
        return {
          type: "whiteboard_draw_table",
          id,
          element_id: stringParam("elementId", "element_id") ?? null,
          x: numberParam("x") ?? 0,
          y: numberParam("y") ?? 0,
          width: numberParam("width") ?? 0,
          height: numberParam("height") ?? 0,
          data: Array.isArray(payload.data) ? (payload.data as string[][]) : [],
          outline: outline
            ? {
                width: numberParam("outlineWidth") ?? (typeof outline.width === "number" ? outline.width : 1),
                style:
                  stringParam("outlineStyle") ??
                  (typeof outline.style === "string" ? outline.style : "solid"),
                color:
                  stringParam("outlineColor") ??
                  (typeof outline.color === "string" ? outline.color : "#cccccc"),
              }
            : null,
          theme: theme
            ? {
                color:
                  stringParam("themeColor") ??
                  (typeof theme.color === "string" ? theme.color : "#000000"),
              }
            : null,
        };
      }
    case "wb_draw_line":
      {
        const points = stringArrayParam("points");
        const resolvedPoints =
          points && points.length >= 2 ? ([points[0], points[1]] as [string, string]) : null;
        return {
          type: "whiteboard_draw_line",
          id,
          element_id: stringParam("elementId", "element_id") ?? null,
          start_x: numberParam("startX", "start_x") ?? 0,
          start_y: numberParam("startY", "start_y") ?? 0,
          end_x: numberParam("endX", "end_x") ?? 0,
          end_y: numberParam("endY", "end_y") ?? 0,
          color: stringParam("color") ?? null,
          width: numberParam("width", "strokeWidth", "stroke_width") ?? null,
          style:
            (stringParam("style", "lineStyle") as "solid" | "dashed" | undefined) ?? null,
          points: resolvedPoints,
        };
      }
    default:
      return null;
  }
}

function buildRuntimeActionExecutionKey(event: TutorStreamEvent, action: LessonAction): string {
  const params = event.action_params ?? {};
  const normalized = stableSerialize(params as Record<string, unknown>);
  const canonicalActionName =
    typeof (params as Record<string, unknown>).action_name === "string"
      ? ((params as Record<string, unknown>).action_name as string)
      : null;
  return `${event.runtime_session_id ?? event.session_id}:${canonicalActionName ?? event.action_name ?? action.type}:${normalized}`;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${key}:${stableSerialize(record[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
}

function summarizeTutorRuntimeEvent(event: TutorStreamEvent) {
  switch (event.kind) {
    case "action_started":
    case "action_completed":
      return `${event.kind.replace("_", " ")}: ${event.action_name ?? "action"}`;
    case "text_delta":
      return "streamed tutor text";
    case "interrupted":
      return event.message ?? "discussion interrupted";
    case "resume_available":
      return event.message ?? "resume available";
    case "resume_rejected":
      return event.message ?? "resume rejected";
    case "agent_selected":
      return `agent: ${event.agent_name ?? event.agent_id ?? "unknown"}`;
    case "cue_user":
      return event.message ?? "cue user";
    case "done":
      return "discussion complete";
    case "error":
      return event.message ?? "runtime error";
    default:
      return event.kind;
  }
}

function summarizeAction(action: LessonAction) {
  if ("text" in action) {
    return action.audio_url ? `${action.text} (audio attached)` : action.text;
  }

  if ("topic" in action) {
    return action.topic;
  }

  if (action.type.startsWith("whiteboard_")) {
    return `Whiteboard: ${action.type.replace("whiteboard_", "")}`;
  }

  if ("element_id" in action) {
    return `Targets element ${Reflect.get(action, "element_id")}`;
  }

  return action.type;
}
