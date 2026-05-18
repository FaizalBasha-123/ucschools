/**
 * Director prompt types — minimal stub for chat/roundtable features.
 * These are NOT used by the generation pipeline (which is now Rust-backed).
 */

export interface AgentTurnSummary {
  agentId: string;
  content: string;
  timestamp: number;
}

export interface WhiteboardActionRecord {
  actionType: string;
  elementId: string;
  payload?: Record<string, unknown>;
  timestamp: number;
}
