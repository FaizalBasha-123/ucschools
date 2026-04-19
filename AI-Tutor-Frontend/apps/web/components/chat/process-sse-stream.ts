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
            const rawPayload = JSON.parse(line.slice(6));
            // Support both standard SSE (pendingEventName) and legacy wrapped { type, data }
            const eventType = rawPayload.type || pendingEventName;
            const eventData = rawPayload.data || rawPayload;
            
            switch (eventType) {
              case 'session_started':
              case 'agent_start': {
                // Compatibility for Rust naming if needed
                const { messageId, agentId, agentName, agentAvatar, agentColor } = eventData;
                currentMessageId = messageId || currentMessageId;
                if (currentMessageId) {
                  buffer.pushAgentStart({
                    messageId: currentMessageId,
                    agentId,
                    agentName,
                    avatar: agentAvatar,
                    color: agentColor,
                  });
                }
                break;
              }

              case 'agent_end': {
                buffer.pushAgentEnd({
                  messageId: eventData.messageId || currentMessageId!,
                  agentId: eventData.agentId,
                });
                break;
              }

              case 'text_delta': {
                const targetId = eventData.messageId ?? currentMessageId;
                if (!targetId) break;
                buffer.pushText(targetId, eventData.content ?? eventData.text);
                break;
              }

              case 'action_started':
              case 'action': {
                const targetId = eventData.messageId ?? currentMessageId;
                if (!targetId) break;
                if (signal?.aborted) break;
                buffer.pushAction({
                  messageId: targetId,
                  actionId: eventData.actionId,
                  actionName: eventData.actionName,
                  params: eventData.params,
                  agentId: eventData.agentId,
                });
                break;
              }

              case 'thinking': {
                buffer.pushThinking({
                  stage: eventData.stage ?? 'director',
                  agentId: eventData.agentId ?? eventData.agent_id,
                  detail: eventData.detail ?? eventData.message ?? eventData.thinking_detail,
                });
                break;
              }

              case 'cue_user': {
                buffer.pushCueUser(eventData);
                break;
              }

              case 'done': {
                buffer.pushDone(eventData);
                break;
              }

              case 'error': {
                sseError = new Error(eventData.message);
                buffer.pushError(eventData.message);
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
