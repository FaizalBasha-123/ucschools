/**
 * Agent registry store — minimal stub for chat/roundtable features.
 * These are NOT used by the generation pipeline (which is now Rust-backed).
 */

import { create } from 'zustand';
import type { AgentConfig } from './types';

interface AgentRegistryState {
  agents: Record<string, AgentConfig>;
  getAgent: (id: string) => AgentConfig | undefined;
}

export const useAgentRegistry = create<AgentRegistryState>(() => ({
  agents: {},
  getAgent: (id: string) => undefined,
}));

export function agentsToParticipants(
  agentIds: string[],
  _t?: (key: string) => string,
): Array<{ id: string; name: string; avatar: string; role: 'teacher' | 'student' | 'user'; isOnline: boolean }> {
  return agentIds.map((id) => ({
    id,
    name: id,
    avatar: '',
    role: 'student' as const,
    isOnline: true,
  }));
}

export async function saveGeneratedAgents(
  _stageId: string,
  _configs: AgentConfig[],
): Promise<string[]> {
  return [];
}

export async function loadGeneratedAgentsForStage(_stageId: string): Promise<string[]> {
  return [];
}
