'use client';

/**
 * PBL Chat Hook - Manages chat state, @mention parsing, and API calls
 */

import { useState, useCallback } from 'react';
import type { PBLProjectConfig, PBLChatMessage, PBLAgent, PBLIssue } from '@/lib/pbl/types';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createLogger } from '@/lib/logger';

const log = createLogger('PBLChat');

interface UsePBLChatOptions {
  projectConfig: PBLProjectConfig;
  userRole: string;
  onConfigUpdate: (config: PBLProjectConfig) => void;
}

export function usePBLChat({ projectConfig, userRole, onConfigUpdate }: UsePBLChatOptions) {
  const { t } = useI18n();
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

      // Add user message
      const userMsg: PBLChatMessage = {
        id: `msg_${Date.now()}_user`,
        agent_name: userRole,
        message: text,
        timestamp: Date.now(),
        read_by: [userRole],
      };
      updatedConfig.chat.messages.push(userMsg);
      onConfigUpdate(updatedConfig);

      // Parse @mention to determine target agent, fallback to question agent
      const targetAgent = resolveTargetAgent(text, currentIssue, projectConfig.agents);
      if (!targetAgent) return;

      setIsLoading(true);

      try {
        const modelConfig = getCurrentModelConfig();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-model': modelConfig.modelString,
          'x-api-key': modelConfig.apiKey,
        };
        if (modelConfig.baseUrl) headers['x-base-url'] = modelConfig.baseUrl;
        if (modelConfig.providerType) headers['x-provider-type'] = modelConfig.providerType;
        if (modelConfig.requiresApiKey) headers['x-requires-api-key'] = 'true';

        // Strip @mention prefix from message text if present
        const cleanMessage = text.replace(/^@\w+\s*/i, '').trim() || text;

        const response = await fetch('/api/pbl/chat', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            message: cleanMessage,
            project_config: projectConfig,
            workspace: projectConfig.issueboard,
            recent_messages: updatedConfig.chat.messages.slice(-10).map((m) => ({
              agent_name: m.agent_name,
              message: m.message,
            })),
            user_role: userRole,
            session_id: null,
          }),
        });

        const data = await response.json();

        if (data.messages) {
          const newMessages = data.messages.map((msg: any) => ({
            id: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            agent_name: msg.agent_name,
            message: msg.message,
            timestamp: Date.now(),
            read_by: [],
          }));

          const afterConfig = {
            ...updatedConfig,
            chat: { messages: [...updatedConfig.chat.messages, ...newMessages] },
          };

          if (data.workspace) {
            afterConfig.issueboard = data.workspace;
          }

          onConfigUpdate(afterConfig);
        }
      } catch (error) {
        log.error('[usePBLChat] Error:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [projectConfig, userRole, currentIssue, isLoading, onConfigUpdate, t],
  );

  return { messages, isLoading, sendMessage, currentIssue };
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

    // Direct agent name mention
    const matched = agents.find((a) => a.name.toLowerCase().includes(mentionType));
    if (matched) return matched;
  }

  // No @mention or unrecognized mention → route to question agent by default
  return agents.find((a) => a.name === currentIssue.question_agent_name) || null;
}
