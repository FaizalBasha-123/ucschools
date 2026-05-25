/**
 * Whiteboard Doubt Session — TypeScript types
 *
 * Mirrors the Rust WhiteboardActionEvent serde enum in
 * crates/orchestrator/src/whiteboard_doubt.rs
 *
 * All coordinates are in 960×540 whiteboard canvas space.
 */

// ─── Individual action events ────────────────────────────────────────────────

export type WbSpeakEvent = {
  type: 'speak';
  id: string;
  text: string;
};

export type WbDrawTextEvent = {
  type: 'draw_text';
  id: string;
  content: string;
  x: number;
  y: number;
  font_size: number;
  color: string;
};

export type WbDrawShapeEvent = {
  type: 'draw_shape';
  id: string;
  shape: 'rectangle' | 'circle' | 'triangle' | string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill_color?: string | null;
  stroke_color: string;
};

export type WbDrawArrowEvent = {
  type: 'draw_arrow';
  id: string;
  start_x: number;
  start_y: number;
  end_x: number;
  end_y: number;
  color: string;
  label?: string | null;
};

export type WbDrawLatexEvent = {
  type: 'draw_latex';
  id: string;
  latex: string;
  x: number;
  y: number;
  color: string;
};

export type WbDrawChartEvent = {
  type: 'draw_chart';
  id: string;
  chart_type: 'bar' | 'line' | 'pie' | string;
  x: number;
  y: number;
  width: number;
  height: number;
  data: unknown;
};

export type WbDrawImageEvent = {
  type: 'draw_image';
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  alt?: string | null;
};

export type WbClearEvent = {
  type: 'clear';
  id: string;
};

export type WbDoneEvent = {
  type: 'done';
  credits_used: number;
  image_count: number;
};

export type WhiteboardActionEvent =
  | WbSpeakEvent
  | WbDrawTextEvent
  | WbDrawShapeEvent
  | WbDrawArrowEvent
  | WbDrawLatexEvent
  | WbDrawChartEvent
  | WbDrawImageEvent
  | WbClearEvent
  | WbDoneEvent;

// ─── API response ─────────────────────────────────────────────────────────────

export interface WhiteboardDoubtResponse {
  wb_session_id: string;
  actions: WhiteboardActionEvent[];
  credits_used: number;
}

// ─── API request bodies ───────────────────────────────────────────────────────

export interface StartDoubtRequest {
  question: string;
  scene_index: number;
  scene_title: string;
  quality_mode?: string;
  enable_image_generation?: boolean;
}

export interface FollowupDoubtRequest {
  question: string;
}
