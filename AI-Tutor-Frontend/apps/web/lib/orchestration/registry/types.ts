/**
 * Agent registry types — minimal stub for chat/roundtable features.
 * These are NOT used by the generation pipeline (which is now Rust-backed).
 */

import type { TTSProviderId } from '@/lib/audio/types';

export interface VoiceConfig {
  providerId: TTSProviderId;
  modelId?: string;
  voiceId: string;
}

export interface AgentConfig {
  id: string;
  name?: string;
  role?: string;
  description?: string;
  avatar?: string;
  voiceConfig?: VoiceConfig;
  isGenerated?: boolean;
  isDefault?: boolean;
  systemPrompt?: string;
  color?: string;
  persona?: string;
  createdAt?: string;
  updatedAt?: string;
}
