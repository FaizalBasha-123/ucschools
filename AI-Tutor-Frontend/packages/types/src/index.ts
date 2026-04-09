export type LessonGenerationStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export type LessonGenerationStep =
  | "queued"
  | "initializing"
  | "researching"
  | "generating_outlines"
  | "generating_scenes"
  | "generating_media"
  | "generating_tts"
  | "persisting"
  | "completed"
  | "failed";

export type GenerateLessonPayload = {
  requirement: string;
  language?: "en-US" | "zh-CN";
  model?: string;
  pdf_text?: string;
  enable_web_search?: boolean;
  enable_image_generation?: boolean;
  enable_video_generation?: boolean;
  enable_tts?: boolean;
  agent_mode?: "default" | "generate";
  user_nickname?: string;
  user_bio?: string;
};

export type GenerateLessonResponse = {
  lesson_id: string;
  job_id: string;
  url: string;
  scenes_count: number;
};

export type LessonGenerationJob = {
  id: string;
  status: LessonGenerationStatus;
  step: LessonGenerationStep;
  progress: number;
  message: string;
  scenes_generated: number;
  total_scenes?: number | null;
  error?: string | null;
  result?: {
    lesson_id: string;
    url: string;
    scenes_count: number;
  } | null;
};

export type Lesson = {
  id: string;
  title: string;
  language: string;
  description?: string | null;
  style?: string | null;
  scenes: Scene[];
};

export type Scene = {
  id: string;
  stage_id: string;
  title: string;
  order: number;
  content: SceneContent;
  actions: LessonAction[];
};

export type SceneContent =
  | {
      type: "slide";
      canvas: SlideCanvas;
    }
  | {
      type: "quiz";
      questions: QuizQuestion[];
    }
  | {
      type: "interactive";
      url: string;
      html?: string | null;
      scientific_model?: {
        core_formulas: string[];
        mechanism: string[];
        constraints: string[];
        forbidden_errors: string[];
        variables: string[];
        interaction_guidance: string[];
        experiment_steps: string[];
        observation_prompts: string[];
      } | null;
    }
  | {
      type: "project";
      project_config: {
        summary: string;
        title?: string | null;
        driving_question?: string | null;
        final_deliverable?: string | null;
        target_skills?: string[] | null;
        milestones?: string[] | null;
        team_roles?: string[] | null;
        assessment_focus?: string[] | null;
        starter_prompt?: string | null;
        success_criteria?: string[] | null;
        facilitator_notes?: string[] | null;
        agent_roles?:
          | {
              name: string;
              responsibility: string;
              deliverable?: string | null;
            }[]
          | null;
        issue_board?:
          | {
              title: string;
              description: string;
              owner_role?: string | null;
              checkpoints: string[];
            }[]
          | null;
      };
    };

export type SlideCanvas = {
  id: string;
  viewport_width: number;
  viewport_height: number;
  viewport_ratio: number;
  theme: {
    background_color: string;
    theme_colors: string[];
    font_color: string;
    font_name: string;
  };
  elements: SlideElement[];
};

export type SlideElement =
  | {
      kind: "text";
      id: string;
      left: number;
      top: number;
      width: number;
      height: number;
      content: string;
    }
  | {
      kind: "image";
      id: string;
      left: number;
      top: number;
      width: number;
      height: number;
      src: string;
    }
  | {
      kind: "video";
      id: string;
      left: number;
      top: number;
      width: number;
      height: number;
      src: string;
    };

export type QuizQuestion = {
  id: string;
  question: string;
  options?: QuizOption[] | null;
  answer?: string[] | null;
};

export type QuizOption = {
  value: string;
  label: string;
};

export type LessonAction =
  | {
      type: "speech";
      id: string;
      text: string;
      audio_id?: string | null;
      audio_url?: string | null;
      voice?: string | null;
      speed?: number | null;
    }
  | {
      type: "spotlight";
      id: string;
      element_id: string;
    }
  | {
      type: "laser";
      id: string;
      element_id: string;
      color?: string | null;
    }
  | {
      type: "play_video";
      id: string;
      element_id: string;
    }
  | {
      type: "discussion";
      id: string;
      topic: string;
    }
  | {
      type: "whiteboard_open";
      id: string;
      title?: string | null;
      description?: string | null;
    }
  | {
      type: "whiteboard_draw_text";
      id: string;
      title?: string | null;
      description?: string | null;
      element_id?: string | null;
      content: string;
      x: number;
      y: number;
      width?: number | null;
      height?: number | null;
      font_size?: number | null;
      color?: string | null;
    }
  | {
      type: "whiteboard_draw_shape";
      id: string;
      title?: string | null;
      description?: string | null;
      element_id?: string | null;
      shape: "rectangle" | "circle" | "triangle";
      x: number;
      y: number;
      width: number;
      height: number;
      fill_color?: string | null;
    }
  | {
      type: "whiteboard_draw_chart";
      id: string;
      title?: string | null;
      description?: string | null;
      element_id?: string | null;
      chart_type: string;
      x: number;
      y: number;
      width: number;
      height: number;
      data: {
        labels: string[];
        legends: string[];
        series: number[][];
      };
      theme_colors?: string[] | null;
    }
  | {
      type: "whiteboard_draw_latex";
      id: string;
      title?: string | null;
      description?: string | null;
      element_id?: string | null;
      latex: string;
      x: number;
      y: number;
      width?: number | null;
      height?: number | null;
      color?: string | null;
    }
  | {
      type: "whiteboard_draw_table";
      id: string;
      title?: string | null;
      description?: string | null;
      element_id?: string | null;
      x: number;
      y: number;
      width: number;
      height: number;
      data: string[][];
      outline?: {
        width: number;
        style: string;
        color: string;
      } | null;
      theme?: {
        color: string;
      } | null;
    }
  | {
      type: "whiteboard_draw_line";
      id: string;
      title?: string | null;
      description?: string | null;
      element_id?: string | null;
      start_x: number;
      start_y: number;
      end_x: number;
      end_y: number;
      color?: string | null;
      width?: number | null;
      style?: "solid" | "dashed" | null;
      points?: [string, string] | null;
    }
  | {
      type: "whiteboard_clear";
      id: string;
      title?: string | null;
      description?: string | null;
    }
  | {
      type: "whiteboard_delete";
      id: string;
      title?: string | null;
      description?: string | null;
      element_id: string;
    }
  | {
      type: "whiteboard_close";
      id: string;
      title?: string | null;
      description?: string | null;
    };

export type RuntimeMode = "autonomous" | "playback" | "live";

export type ActionExecutionMetadata = {
  surface: "audio" | "discussion" | "slide_overlay" | "video" | "whiteboard";
  blocks_slide_canvas: boolean;
  requires_focus_target: boolean;
};

export type WhiteboardSnapshot = {
  id: string;
  is_open: boolean;
  version: number;
  objects: WhiteboardObject[];
};

export type WhiteboardObject =
  | {
      kind: "path";
      id: string;
      points: { x: number; y: number }[];
      color: string;
      stroke_width: number;
    }
  | {
      kind: "text";
      id: string;
      position: { x: number; y: number };
      content: string;
      font_size: number;
      color: string;
    }
  | {
      kind: "rectangle";
      id: string;
      position: { x: number; y: number };
      width: number;
      height: number;
      color: string;
      fill?: string | null;
      stroke_width: number;
    }
  | {
      kind: "circle";
      id: string;
      center: { x: number; y: number };
      radius: number;
      color: string;
      fill?: string | null;
      stroke_width: number;
    }
  | {
      kind: "highlight";
      id: string;
      position: { x: number; y: number };
      width: number;
      height: number;
      color: string;
      opacity: number;
    }
  | {
      kind: "arrow";
      id: string;
      start: { x: number; y: number };
      end: { x: number; y: number };
      color: string;
      stroke_width: number;
    };

export type PlaybackEvent = {
  lesson_id: string;
  kind: "session_started" | "scene_started" | "action_started" | "session_completed";
  scene_id?: string | null;
  scene_title?: string | null;
  scene_index?: number | null;
  action_id?: string | null;
  action_type?: string | null;
  action_index?: number | null;
  action_payload?: LessonAction | null;
  execution?: ActionExecutionMetadata | null;
  whiteboard_state?: WhiteboardSnapshot | null;
  summary: string;
};

export type ChatMessage = {
  id: string;
  role: string;
  content: string;
};

export type StatelessChatRequest = {
  session_id?: string | null;
  runtime_session?: {
    mode: "stateless_client_state" | "managed_runtime_session";
    session_id?: string | null;
    create_if_missing?: boolean | null;
  } | null;
  messages: ChatMessage[];
  store_state: {
    stage?: null;
    scenes: Scene[];
    current_scene_id?: string | null;
    mode: RuntimeMode;
    whiteboard_open: boolean;
  };
  config: {
    agent_ids: string[];
    session_type?: string | null;
    discussion_topic?: string | null;
    discussion_prompt?: string | null;
    trigger_agent_id?: string | null;
    agent_configs: {
      id: string;
      name: string;
      role: string;
      persona: string;
      avatar: string;
      color: string;
      allowed_actions: string[];
      priority: number;
      is_generated?: boolean | null;
      bound_stage_id?: string | null;
    }[];
  };
  director_state?: {
    turn_count: number;
    agent_responses: {
      agent_id: string;
      agent_name: string;
      content_preview: string;
      action_count: number;
      whiteboard_actions: {
        action_name: string;
        agent_id: string;
        agent_name: string;
      }[];
    }[];
    whiteboard_ledger: {
      action_name: string;
      agent_id: string;
      agent_name: string;
      params?: Record<string, unknown> | null;
    }[];
    whiteboard_state?: WhiteboardSnapshot | null;
  } | null;
  user_profile?: {
    nickname?: string | null;
    bio?: string | null;
  } | null;
  api_key: string;
  base_url?: string | null;
  model?: string | null;
  provider_type?: string | null;
  requires_api_key?: boolean | null;
};

export type ActionAckPolicy = "no_ack_required" | "ack_optional" | "ack_required";

export type RuntimeInterruptionReason =
  | "user_requested"
  | "downstream_disconnect"
  | "provider_cancelled"
  | "provider_failed"
  | "runtime_policy";

export type TutorTurnStatus = "running" | "interrupted" | "completed" | "failed";

type TutorStreamEventBase = {
  session_id: string;
  runtime_session_id?: string | null;
  runtime_session_mode?: "stateless_client_state" | "managed_runtime_session" | null;
  turn_status?: TutorTurnStatus | null;
  interruption_reason?: RuntimeInterruptionReason | null;
  resume_allowed?: boolean | null;
  agent_id?: string | null;
  agent_name?: string | null;
  message?: string | null;
};

export type TutorStreamEvent =
  | (TutorStreamEventBase & {
      kind: "session_started";
      action_name?: null;
      action_params?: null;
      execution_id?: null;
      ack_policy?: null;
      execution?: null;
      whiteboard_state?: null;
      content?: string | null;
      director_state?: null;
    })
  | (TutorStreamEventBase & {
      kind: "agent_selected";
      action_name?: null;
      action_params?: null;
      execution_id?: null;
      ack_policy?: null;
      execution?: null;
      whiteboard_state?: null;
      content?: string | null;
      director_state?: null;
    })
  | (TutorStreamEventBase & {
      kind: "text_delta";
      action_name?: null;
      action_params?: null;
      execution_id?: null;
      ack_policy?: null;
      execution?: null;
      whiteboard_state?: null;
      content?: string | null;
      director_state?: null;
    })
  | (TutorStreamEventBase & {
      kind: "action_started" | "action_progress" | "action_completed";
      action_name?: string | null;
      action_params?: Record<string, unknown> | null;
      execution_id?: string | null;
      ack_policy?: ActionAckPolicy | null;
      execution?: ActionExecutionMetadata | null;
      whiteboard_state?: WhiteboardSnapshot | null;
      content?: null;
      director_state?: null;
    })
  | (TutorStreamEventBase & {
      kind: "interrupted" | "resume_available" | "resume_rejected";
      action_name?: null;
      action_params?: null;
      execution_id?: null;
      ack_policy?: null;
      execution?: null;
      whiteboard_state?: WhiteboardSnapshot | null;
      content?: string | null;
      director_state?: StatelessChatRequest["director_state"] | null;
    })
  | (TutorStreamEventBase & {
      kind: "cue_user";
      action_name?: null;
      action_params?: null;
      execution_id?: null;
      ack_policy?: null;
      execution?: null;
      whiteboard_state?: null;
      content?: string | null;
      director_state?: null;
    })
  | (TutorStreamEventBase & {
      kind: "done" | "error";
      action_name?: null;
      action_params?: null;
      execution_id?: null;
      ack_policy?: null;
      execution?: null;
      whiteboard_state?: WhiteboardSnapshot | null;
      content?: string | null;
      director_state?: StatelessChatRequest["director_state"] | null;
    });
