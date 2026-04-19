'use client';

/**
 * PBL Chat Hook - Manages chat state, @mention parsing, and API calls
 */

import { useState, useCallback } from 'react';
import type { PBLProjectConfig, PBLChatMessage, PBLAgent, PBLIssue, PBLIssueboard } from '@/lib/pbl/types';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { createLogger } from '@/lib/logger';

const log = createLogger('PBLChat');

interface UsePBLChatOptions {
  sessionId: string;
  projectConfig: PBLProjectConfig;
  userRole: string;
  onConfigUpdate: (config: PBLProjectConfig) => void;
}

interface RuntimeWorkspaceIssue {
  id: string;
  title: string;
  description: string;
  owner_role?: string;
  checkpoints: string[];
  completed_checkpoint_ids: string[];
  done: boolean;
}

interface RuntimeWorkspaceState {
  active_issue_id: string | null;
  issues: RuntimeWorkspaceIssue[];
}

interface RuntimeChatMessage {
  kind?: string;
  agent_name?: string;
  message?: string;
}

interface RuntimeChatResponse {
  messages?: RuntimeChatMessage[];
  workspace?: RuntimeWorkspaceState;
}

export function usePBLChat({ sessionId, projectConfig, userRole, onConfigUpdate }: UsePBLChatOptions) {
  const [isLoading, setIsLoading] = useState(false);

  const messages = projectConfig.chat.messages;

  const currentIssue = projectConfig.issueboard.issues.find((i) => i.is_active) || null;

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const updatedConfig = {
        ...projectConfig,
        chat: {
          ...projectConfig.chat,
          messages: [...projectConfig.chat.messages],
        },
      };

      const userMsg: PBLChatMessage = {
        id: `msg_${Date.now()}_user`,
        agent_name: userRole,
        message: text,
        timestamp: Date.now(),
        read_by: [userRole],
      };
      updatedConfig.chat.messages.push(userMsg);
      onConfigUpdate(updatedConfig);

      const targetAgent = resolveTargetAgent(text, currentIssue, projectConfig.agents);
      if (!targetAgent) return;

      setIsLoading(true);

      try {
        const modelConfig = getCurrentModelConfig();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-api-key': modelConfig.apiKey,
        };
        if (modelConfig.baseUrl) headers['x-base-url'] = modelConfig.baseUrl;
        if (modelConfig.providerType) headers['x-provider-type'] = modelConfig.providerType;
        if (modelConfig.requiresApiKey) headers['x-requires-api-key'] = 'true';

        // Keep @mention routing local for target selection, but send clean text to runtime.
        const cleanMessage = text.replace(/^@\w+\s*/i, '').trim() || text;

        const response = await fetch('/api/pbl/chat', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            message: cleanMessage,
            project_config: projectConfig,
            workspace: toRuntimeWorkspace(projectConfig.issueboard),
            recent_messages: updatedConfig.chat.messages.slice(-10).map((m) => ({
              kind: m.agent_name === userRole ? 'user' : 'agent',
              agent_name: m.agent_name,
              message: m.message,
            })),
            user_role: userRole,
            session_id: sessionId,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || `PBL runtime chat failed with status ${response.status}`);
        }

        const data = (await response.json()) as RuntimeChatResponse;

        const newMessages = (data.messages ?? [])
          .filter((msg) => typeof msg.message === 'string' && msg.message.trim().length > 0)
          .map((msg) => ({
            id: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            agent_name: msg.agent_name || 'System',
            message: msg.message as string,
            timestamp: Date.now(),
            read_by: [],
          }));

        const afterConfig = {
          ...updatedConfig,
          chat: { messages: [...updatedConfig.chat.messages, ...newMessages] },
        };

        if (data.workspace) {
          afterConfig.issueboard = fromRuntimeWorkspace(data.workspace, updatedConfig.issueboard);
        }

        onConfigUpdate(afterConfig);
      } catch (error) {
        log.error('[usePBLChat] Error:', error);

        const errorMessage =
          error instanceof Error ? error.message : 'Project chat is temporarily unavailable.';
        const afterErrorConfig = {
          ...updatedConfig,
          chat: {
            ...updatedConfig.chat,
            messages: [
              ...updatedConfig.chat.messages,
              {
                id: `msg_${Date.now()}_system_error`,
                agent_name: 'System',
                message: errorMessage,
                timestamp: Date.now(),
                read_by: [],
              },
            ],
          },
        };
        onConfigUpdate(afterErrorConfig);
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, projectConfig, userRole, currentIssue, isLoading, onConfigUpdate],
  );

  return { messages, isLoading, sendMessage, currentIssue };
}

function toRuntimeWorkspace(issueboard: PBLIssueboard): RuntimeWorkspaceState {
  const activeIssueId =
    issueboard.current_issue_id ?? issueboard.issues.find((issue) => issue.is_active)?.id ?? null;

  return {
    active_issue_id: activeIssueId,
    issues: issueboard.issues.map((issue) => ({
      id: issue.id,
      title: issue.title,
      description: issue.description,
      owner_role: issue.person_in_charge || undefined,
      checkpoints: [],
      completed_checkpoint_ids: [],
      done: issue.is_done,
    })),
  };
}

function fromRuntimeWorkspace(
  workspace: RuntimeWorkspaceState,
  previous: PBLIssueboard,
): PBLIssueboard {
  const byId = new Map(previous.issues.map((issue) => [issue.id, issue]));

  const issues = workspace.issues.map((issue, index) => {
    const existing = byId.get(issue.id);
    return {
      id: issue.id,
      title: issue.title,
      description: issue.description,
      person_in_charge: issue.owner_role || existing?.person_in_charge || '',
      participants: existing?.participants || [],
      notes: existing?.notes || '',
      parent_issue: existing?.parent_issue ?? null,
      index: existing?.index ?? index,
      is_done: issue.done,
      is_active: workspace.active_issue_id === issue.id,
      generated_questions: existing?.generated_questions || '',
      question_agent_name: existing?.question_agent_name || 'Question Agent',
      judge_agent_name: existing?.judge_agent_name || 'Judge Agent',
    };
  });

  return {
    agent_ids: previous.agent_ids,
    current_issue_id: workspace.active_issue_id,
    issues,
  };
}

/**
 * Resolve target agent from @mention, or fallback to question agent for plain messages
 */
function resolveTargetAgent(
  text: string,
  currentIssue: PBLIssue | null,
  agents: PBLAgent[],
): PBLAgent | null {
  if (!currentIssue) return null;

  const mentionMatch = text.match(/^@(\w+)/i);
  if (mentionMatch) {
    const mentionType = mentionMatch[1].toLowerCase();

    if (mentionType === 'question') {
      return agents.find((a) => a.name === currentIssue.question_agent_name) || null;
    }
    if (mentionType === 'judge') {
      return agents.find((a) => a.name === currentIssue.judge_agent_name) || null;
    }

    const matched = agents.find((a) => a.name.toLowerCase().includes(mentionType));
    if (matched) return matched;
  }

  return agents.find((a) => a.name === currentIssue.question_agent_name) || null;
}
