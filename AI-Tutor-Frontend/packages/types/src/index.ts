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
    }
  | {
      type: "project";
      project_config: {
        summary: string;
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
      type: "discussion";
      id: string;
      topic: string;
    };

export type RuntimeMode = "autonomous" | "playback" | "live";

export type ChatMessage = {
  id: string;
  role: string;
  content: string;
};

export type StatelessChatRequest = {
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
    }[];
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

export type TutorStreamEvent =
  | {
      kind: "session_started";
      session_id: string;
      agent_id?: string | null;
      agent_name?: string | null;
      content?: string | null;
      message?: string | null;
      director_state?: null;
    }
  | {
      kind: "agent_selected";
      session_id: string;
      agent_id?: string | null;
      agent_name?: string | null;
      content?: string | null;
      message?: string | null;
      director_state?: null;
    }
  | {
      kind: "text_delta";
      session_id: string;
      agent_id?: string | null;
      agent_name?: string | null;
      content?: string | null;
      message?: string | null;
      director_state?: null;
    }
  | {
      kind: "cue_user";
      session_id: string;
      agent_id?: string | null;
      agent_name?: string | null;
      content?: string | null;
      message?: string | null;
      director_state?: null;
    }
  | {
      kind: "done" | "error";
     