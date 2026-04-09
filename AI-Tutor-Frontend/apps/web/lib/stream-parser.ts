/**
 * Interleaved JSON Array Stream Parser
 *
 * Ported from OpenMAIC's `stateless-generate.ts` parsing strategy.
 * Uses `partial-json` + `jsonrepair` for robust incremental parsing
 * instead of naive brace-matching which breaks on LaTeX content.
 *
 * Architecture (matches OpenMAIC exactly):
 *   1. Accumulate chunks into a buffer
 *   2. Skip prefix before `[` (markdown fences, explanatory text)
 *   3. Use partial-json to incrementally parse the growing array
 *   4. Emit newly complete items (action → onAction, text → onTextDelta)
 *   5. Stream partial text deltas for the trailing incomplete text item
 *   6. finalize() handles plain-text fallback when no JSON was found
 */

import { parse as parsePartialJson, Allow } from 'partial-json';
import { jsonrepair } from 'jsonrepair';

// ── Types ──

export type StreamAction = {
  type: 'action';
  name: string;
  params: Record<string, unknown>;
};

export type StreamText = {
  type: 'text';
  content: string;
};

export type InterleavedElement = StreamAction | StreamText;

// ── Parser State (mirrors OpenMAIC's ParserState interface) ──

interface ParserState {
  buffer: string;
  jsonStarted: boolean;
  lastParsedItemCount: number;
  lastPartialTextLength: number;
  isDone: boolean;
}

// ── Parser Class ──

export class InterleavedParser {
  private state: ParserState;

  constructor(
    private callbacks: {
      onAction: (action: StreamAction) => void;
      onTextDelta: (delta: string) => void;
      onError?: (err: Error) => void;
    },
  ) {
    this.state = {
      buffer: '',
      jsonStarted: false,
      lastParsedItemCount: 0,
      lastPartialTextLength: 0,
      isDone: false,
    };
  }

  /**
   * Push a new chunk from the SSE stream.
   * Matches OpenMAIC's parseStructuredChunk().
   */
  public push(chunk: string): void {
    if (this.state.isDone) return;

    this.state.buffer += chunk;

    // Step 1: Find opening `[` if not yet found
    if (!this.state.jsonStarted) {
      const bracketIndex = this.state.buffer.indexOf('[');
      if (bracketIndex === -1) return;
      this.state.buffer = this.state.buffer.slice(bracketIndex);
      this.state.jsonStarted = true;
    }

    // Step 2: Check if array is closed
    const trimmed = this.state.buffer.trimEnd();
    const isArrayClosed = trimmed.endsWith(']') && trimmed.length > 1;

    // Step 3: Incremental parse — jsonrepair first, fallback to partial-json
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any[];
    try {
      const repaired = jsonrepair(this.state.buffer);
      parsed = JSON.parse(repaired);
    } catch {
      try {
        parsed = parsePartialJson(
          this.state.buffer,
          Allow.ARR | Allow.OBJ | Allow.STR | Allow.NUM | Allow.BOOL | Allow.NULL,
        );
      } catch {
        return; // Wait for more data
      }
    }

    if (!Array.isArray(parsed)) return;

    // Step 4: Determine complete items
    const completeUpTo = isArrayClosed
      ? parsed.length
      : Math.max(0, parsed.length - 1);

    // Step 5: Emit newly completed items
    for (let i = this.state.lastParsedItemCount; i < completeUpTo; i++) {
      const item = parsed[i];
      if (!item || typeof item !== 'object') continue;

      // Handle trailing partial text that was already streamed incrementally
      if (
        i === this.state.lastParsedItemCount &&
        this.state.lastPartialTextLength > 0 &&
        item.type === 'text'
      ) {
        const content = item.content || '';
        const remaining = content.slice(this.state.lastPartialTextLength);
        if (remaining) {
          this.callbacks.onTextDelta(remaining);
        }
        this.state.lastPartialTextLength = 0;
        continue;
      }

      this.emitItem(item);
    }

    this.state.lastParsedItemCount = completeUpTo;

    // Step 6: Stream partial text delta for trailing item
    if (!isArrayClosed && parsed.length > completeUpTo) {
      const lastItem = parsed[parsed.length - 1];
      if (
        lastItem &&
        typeof lastItem === 'object' &&
        lastItem.type === 'text'
      ) {
        const content = lastItem.content || '';
        if (content.length > this.state.lastPartialTextLength) {
          this.callbacks.onTextDelta(
            content.slice(this.state.lastPartialTextLength),
          );
          this.state.lastPartialTextLength = content.length;
        }
      }
    }

    // Step 7: Mark done
    if (isArrayClosed) {
      this.state.isDone = true;
      this.state.lastParsedItemCount = parsed.length;
      this.state.lastPartialTextLength = 0;
    }
  }

  /**
   * Finalize after stream ends.
   * Handles plain-text fallback (Gap 6).
   * Matches OpenMAIC's finalizeParser().
   */
  public finalize(): void {
    if (this.state.isDone) return;

    const content = this.state.buffer.trim();
    if (!content) return;

    if (!this.state.jsonStarted) {
      // Model never output `[` — treat entire buffer as speech
      this.callbacks.onTextDelta(content);
    } else {
      // JSON started but never closed — try one final parse
      this.push('');

      // If nothing was emitted, emit raw text as fallback
      if (
        this.state.lastParsedItemCount === 0 &&
        this.state.lastPartialTextLength === 0
      ) {
        const bracketIndex = content.indexOf('[');
        const raw = content.slice(bracketIndex + 1).trim();
        if (raw) {
          this.callbacks.onTextDelta(raw);
        }
      }
    }

    this.state.isDone = true;
  }

  private emitItem(item: Record<string, unknown>): void {
    try {
      if (item.type === 'text') {
        const content = ((item.content as string) || '').trim();
        if (content) {
          this.callbacks.onTextDelta(content);
        }
      } else if (item.type === 'action') {
        const action: StreamAction = {
          type: 'action',
          name: ((item.name || item.tool_name) as string) || '',
          params: ((item.params || item.parameters) as Record<string, unknown>) || {},
        };
        if (action.name) {
          this.callbacks.onAction(action);
        }
      }
    } catch (e) {
      if (this.callbacks.onError) {
        this.callbacks.onError(e as Error);
      }
    }
  }
}
