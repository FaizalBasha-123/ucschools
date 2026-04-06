"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ChatMessage,
  Lesson,
  LessonAction,
  Scene,
  SlideElement,
  StatelessChatRequest,
  TutorStreamEvent,
} from "@ai-tutor/types";
import { Button, Panel, Pill, Shell, Stat } from "@ai-tutor/ui";
import { streamTutorChat } from "../lib/api";

type LessonPlayerShellProps = {
  lesson: Lesson;
  jobStatus?: {
    id: string;
    status: string;
    step: string;
    message: string;
  } | null;
};

export function LessonPlayerShell({ lesson, jobStatus }: LessonPlayerShellProps) {
  const sortedScenes = useMemo(
    () => [...lesson.scenes].sort((left, right) => left.order - right.order),
    [lesson.scenes],
  );
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(
    sortedScenes[0]?.id ?? null,
  );
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [audioIntentToken, setAudioIntentToken] = useState(0);
  const [guidedPlaybackEnabled, setGuidedPlaybackEnabled] = useState(false);
  const [discussionPrompt, setDiscussionPrompt] = useState("");
  const [tutorResponse, setTutorResponse] = useState("");
  const [tutorStatus, setTutorStatus] = useState<"idle" | "streaming" | "done" | "error">("idle");
  const [tutorError, setTutorError] = useState<string | null>(null);
  const [directorState, setDirectorState] = useState<StatelessChatRequest["director_state"]>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const selectedScene =
    sortedScenes.find((scene) => scene.id === selectedSceneId) ?? sortedScenes[0] ?? null;
  const selectedSceneIndex = selectedScene
    ? sortedScenes.findIndex((scene) => scene.id === selectedScene.id)
    : -1;
  const selectedAction = selectedScene?.actions[selectedActionIndex] ?? null;
  const actionCount = selectedScene?.actions.length ?? 0;
  const selectedVideoElement = useMemo(
    () => findFocusedVideoElement(selectedScene, selectedAction),
    [selectedAction, selectedScene],
  );

  useEffect(() => {
    setSelectedActionIndex(0);
  }, [selectedSceneId]);

  useEffect(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
    }
  }, [selectedSceneId, selectedActionIndex]);

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
                focusedVideoElementId={selectedVideoElement?.id ?? null}
                guidedPlaybackEnabled={guidedPlaybackEnabled}
                onToggleGuidedPlayback={() =>
                  setGuidedPlaybackEnabled((current) => !current)
                }
                onPlayAudio={() => setAudioIntentToken((value) => value + 1)}
                onNextAction={() => jumpToAction(selectedActionIndex + 1)}
                onPreviousAction={() => jumpToAction(selectedActionIndex - 1)}
                scene={selectedScene}
              />
              <ActionSurface action={selectedAction} scene={selectedScene} />
              {selectedAction?.type === "discussion" ? (
                <TutorDiscussionPanel
                  directorState={directorState}
                  lesson={lesson}
                  prompt={discussionPrompt}
                  response={tutorResponse}
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

                    const payload = buildTutorPayload(
                      lesson,
                      selectedScene,
                      selectedAction.topic,
                      trimmedPrompt,
                      directorState,
                    );

                    try {
                      await streamTutorChat(payload, (event) => {
                        handleTutorEvent(event, setTutorResponse, setTutorStatus, setDirectorState);
                      });
                    } catch (error) {
                      setTutorStatus("error");
                      setTutorError(error instanceof Error ? error.message : String(error));
                    }
                  }}
                />
              ) : null}
              <ScenePanel
                audioIntentToken={audioIntentToken}
                guidedPlaybackEnabled={guidedPlaybackEnabled}
                onAdvanceAfterAudio={advancePlaybackStep}
                onAdvanceAfterVideo={advancePlaybackStep}
                onAudioReady={(element) => {
                  currentAudioRef.current = element;
                }}
                scene={selectedScene}
                selectedAction={selectedAction}
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
  audioIntentToken,
  guidedPlaybackEnabled,
  onAdvanceAfterAudio,
  onAdvanceAfterVideo,
  onAudioReady,
}: {
  scene: Scene;
  selectedAction: LessonAction | null;
  audioIntentToken: number;
  guidedPlaybackEnabled: boolean;
  onAdvanceAfterAudio: () => void;
  onAdvanceAfterVideo: () => void;
  onAudioReady: (element: HTMLAudioElement | null) => void;
}) {
  if (scene.content.type === "slide") {
    const focusedVideoElement = findFocusedVideoElement(scene, selectedAction);

    return (
      <Panel eyebrow="Slide Scene" title={scene.title}>
        <div className="slide-canvas">
          {scene.content.canvas.elements.map((element) => (
            <div
              key={element.id}
              className={`slide-element ${
                selectedAction?.type === "spotlight" &&
                "element_id" in selectedAction &&
                selectedAction.element_id === element.id
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
        </div>
        {selectedAction?.type === "speech" ? (
          <InlineAudioDock
            action={selectedAction}
            audioIntentToken={audioIntentToken}
            guidedPlaybackEnabled={guidedPlaybackEnabled}
            onAdvanceAfterAudio={onAdvanceAfterAudio}
            onAudioReady={onAudioReady}
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
  audioIntentToken,
  guidedPlaybackEnabled,
  onAdvanceAfterAudio,
  onAudioReady,
}: {
  action: Extract<LessonAction, { type: "speech" }>;
  audioIntentToken: number;
  guidedPlaybackEnabled: boolean;
  onAdvanceAfterAudio: () => void;
  onAudioReady: (element: HTMLAudioElement | null) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    onAudioReady(audioRef.current);
    return () => onAudioReady(null);
  }, [onAudioReady, action.id]);

  useEffect(() => {
    if (!audioRef.current || !action.audio_url || audioIntentToken === 0) {
      return;
    }

    void audioRef.current.play().catch(() => {
      // Browser autoplay rules may still block playback.
    });
  }, [action.audio_url, audioIntentToken]);

  useEffect(() => {
    if (!audioRef.current || !action.audio_url || !guidedPlaybackEnabled) {
      return;
    }

    audioRef.current.currentTime = 0;
    void audioRef.current.play().catch(() => {
      // Browser autoplay rules may still block playback.
    });
  }, [action.audio_url, action.id, guidedPlaybackEnabled]);

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

function findFocusedVideoElement(scene: Scene | null, action: LessonAction | null) {
  if (!scene || scene.content.type !== "slide") {
    return null;
  }

  const videoElements = scene.content.canvas.elements.filter(
    (element): element is Extract<SlideElement, { kind: "video" }> => element.kind === "video",
  );

  if (videoElements.length === 0) {
    return null;
  }

  if (action?.type === "spotlight") {
    return videoElements.find((element) => element.id === action.element_id) ?? videoElements[0];
  }

  return videoElements[0];
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
        <div className="discussion-response">
          <strong>Turn memory</strong>
          <p>
            {directorState
              ? `${directorState.turn_count} tutor turn(s) stored for lesson ${lesson.title} / scene ${scene.title}.`
              : "No director state has been returned yet."}
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
): StatelessChatRequest {
  const messages: ChatMessage[] = [
    {
      id: `user-${Date.now()}`,
      role: "user",
      content: prompt,
    },
  ];

  return {
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
          allowed_actions: ["speech", "discussion"],
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
  setTutorResponse: React.Dispatch<React.SetStateAction<string>>,
  setTutorStatus: React.Dispatch<React.SetStateAction<"idle" | "streaming" | "done" | "error">>,
  setDirectorState: React.Dispatch<React.SetStateAction<StatelessChatRequest["director_state"]>>,
) {
  if (event.kind === "text_delta" && event.content) {
    setTutorResponse((current) => `${current}${event.content}`);
    return;
  }

  if (event.kind === "done") {
    setTutorStatus("done");
    setDirectorState(event.director_state ?? null);
    return;
  }

  if (event.kind === "error") {
    setTutorStatus("error");
  }
}

function summarizeAction(action: LessonAction) {
  if ("text" in action) {
    return action.audio_url ? `${action.text} (audio attached)` : action.text;
  }

  if ("topic" in action) {
    return action.topic;
  }

  if ("element_id" in action) {
    return `Targets element ${action.element_id}`;
  }

  const _exhaustive: never = action;
  return _exhaustive;
}
