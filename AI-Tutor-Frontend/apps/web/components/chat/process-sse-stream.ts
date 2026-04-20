import type { StatelessEvent } from '@/lib/types/chat';
import type { StreamBuffer } from '@/lib/buffer/stream-buffer';
import { createLogger } from '@/lib/logger';

const log = createLogger('SSEStream');

/**
 * Thin SSE parser — reads the /api/chat response stream and pushes
 * typed events into a StreamBuffer. All pacing, state management,
 * and UI updates are handled by the buffer's tick loop and callbacks.
 */
export async function processSSEStream(
  response: Response,
  sessionId: string,
  buffer: StreamBuffer,
  signal?: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let sseBuffer = '';
  let currentMessageId: string | null = null;
  let currentAgentId: string | null = null;
  let generatedMessageIndex = 0;
  let totalActions = 0;
  let totalAgents = 0;
  let agentHadContent = false;

  const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

  const readString = (source: Record<string, unknown>, ...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    return undefined;
  };

  const readObject = (source: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | undefined => {
    for (const key of keys) {
      const value = source[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    }
    return undefined;
  };

  const nextMessageId = () => `session-${sessionId}-msg-${++generatedMessageIndex}`;

  const startAgentMessage = (eventData: Record<string, unknown>, messageId?: string) => {
    const agentId = readString(eventData, 'agentId', 'agent_id') ?? currentAgentId ?? 'default-1';
    const agentName = readString(eventData, 'agentName', 'agent_name') ?? agentId;
    const agentAvatar = readString(eventData, 'agentAvatar', 'agent_avatar');
    const agentColor = readString(eventData, 'agentColor', 'agent_color');
    currentAgentId = agentId;
    currentMessageId = messageId ?? currentMessageId ?? nextMessageId();
    totalAgents += 1;
    buffer.pushAgentStart({
      messageId: currentMessageId,
      agentId,
      agentName,
      avatar: agentAvatar,
      color: agentColor,
    });
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      sseBuffer += chunk;

      // Process complete SSE events (split on double newline)
      const events = sseBuffer.split('\n\n');
      sseBuffer = events.pop() || '';

      let pendingEventName: string | null = null;

      for (const eventStr of events) {
        const lines = eventStr.split('\n');
        let sseError: Error | null = null;

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (line.startsWith('event: ')) {
            pendingEventName = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith('data: ')) continue;

          try {
            const rawPayload = asRecord(JSON.parse(line.slice(6)));
            // Support both standard SSE (pendingEventName) and legacy wrapped { type, data }
            const eventType = readString(rawPayload, 'type') || pendingEventName;
            const eventData = asRecord(readObject(rawPayload, 'data') || rawPayload);
            
            switch (eventType) {
              case 'session_started': {
                currentMessageId = null;
                currentAgentId = null;
                break;
              }

              case 'agent_selected':
              case 'agent_start': {
                const messageId = readString(eventData, 'messageId', 'message_id');
                startAgentMessage(eventData, messageId);
                break;
              }

              case 'agent_end': {
                const messageId = readString(eventData, 'messageId', 'message_id') || currentMessageId;
                const agentId = readString(eventData, 'agentId', 'agent_id') || currentAgentId || 'default-1';
                if (messageId) {
                  buffer.pushAgentEnd({
                    messageId,
                    agentId,
                  });
                }
                break;
              }

              case 'text_delta': {
                const targetId = readString(eventData, 'messageId', 'message_id') ?? currentMessageId;
                if (!targetId) break;
                const delta = readString(eventData, 'content', 'text', 'delta');
                if (!delta) break;
                buffer.pushText(targetId, delta, readString(eventData, 'agentId', 'agent_id') ?? currentAgentId ?? undefined);
                agentHadContent = true;
                break;
              }

              case 'action_started':
              case 'action': {
                const targetId = readString(eventData, 'messageId', 'message_id') ?? currentMessageId;
                if (!targetId) break;
                if (signal?.aborted) break;
                totalActions += 1;
                agentHadContent = true;
                buffer.pushAction({
                  messageId: targetId,
                  actionId: readString(eventData, 'actionId', 'action_id') ?? `${targetId}-action-${totalActions}`,
                  actionName: readString(eventData, 'actionName', 'action_name') ?? 'unknown',
                  params: (readObject(eventData, 'params', 'action_params') ?? {}) as Record<string, unknown>,
                  agentId: readString(eventData, 'agentId', 'agent_id') ?? currentAgentId ?? 'default-1',
                });
                break;
              }

              case 'action_progress':
              case 'action_completed':
              case 'interrupted':
              case 'resume_available':
              case 'resume_rejected': {
                break;
              }

              case 'thinking': {
                buffer.pushThinking({
                  stage: readString(eventData, 'stage') ?? 'director',
                  agentId: readString(eventData, 'agentId', 'agent_id') ?? undefined,
                  detail: readString(eventData, 'detail', 'message', 'thinking_detail') ?? undefined,
                });
                break;
              }

              case 'cue_user': {
                buffer.pushCueUser({
                  fromAgentId: readString(eventData, 'fromAgentId', 'from_agent_id') ?? currentAgentId ?? undefined,
                  prompt: readString(eventData, 'prompt') ?? undefined,
                });
                break;
              }

              case 'done': {
                const directorState = readObject(eventData, 'directorState', 'director_state');
                buffer.pushDone({
                  totalActions,
                  totalAgents,
                  agentHadContent,
                  directorState: directorState as never,
                });
                break;
              }

              case 'error': {
                const message = readString(eventData, 'message') ?? 'Unknown stream error';
                sseError = new Error(message);
                buffer.pushError(message);
                break;
              }
            }
          } catch (parseError) {
            log.warn('[SSE] Parse error:', parseError);
          }

          pendingEventName = null; // Clear after processing data
          if (sseError) throw sseError;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
