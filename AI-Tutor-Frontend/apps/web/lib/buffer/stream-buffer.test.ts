import { describe, expect, it, vi } from 'vitest';

import { StreamBuffer, type StreamBufferCallbacks } from './stream-buffer';

function createCallbacks() {
  const onAgentStart = vi.fn();
  const onAgentEnd = vi.fn();
  const onTextReveal = vi.fn();
  const onActionReady = vi.fn();
  const onLiveSpeech = vi.fn();
  const onSpeechProgress = vi.fn();
  const onThinking = vi.fn();
  const onCueUser = vi.fn();
  const onDone = vi.fn();
  const onError = vi.fn();

  const callbacks: StreamBufferCallbacks = {
    onAgentStart,
    onAgentEnd,
    onTextReveal,
    onActionReady,
    onLiveSpeech,
    onSpeechProgress,
    onThinking,
    onCueUser,
    onDone,
    onError,
  };

  return {
    callbacks,
    spies: {
      onAgentStart,
      onAgentEnd,
      onTextReveal,
      onActionReady,
      onLiveSpeech,
      onSpeechProgress,
      onThinking,
      onCueUser,
      onDone,
      onError,
    },
  };
}

describe('StreamBuffer pause/resume reliability', () => {
  it('freezes progression while paused and continues after resume', () => {
    vi.useFakeTimers();

    const { callbacks, spies } = createCallbacks();
    const buffer = new StreamBuffer(callbacks, {
      tickMs: 10,
      charsPerTick: 1,
    });

    buffer.pushAgentStart({
      messageId: 'm-1',
      agentId: 'teacher-1',
      agentName: 'Teacher',
    });
    buffer.pushText('m-1', 'hello');
    buffer.sealText('m-1');
    buffer.pushDone({ totalActions: 0, totalAgents: 1, agentHadContent: true });

    buffer.start();
    buffer.pause();

    vi.advanceTimersByTime(300);
    expect(spies.onDone).not.toHaveBeenCalled();

    buffer.resume();
    vi.advanceTimersByTime(300);

    expect(spies.onTextReveal).toHaveBeenCalled();
    expect(spies.onDone).toHaveBeenCalledTimes(1);

    buffer.dispose();
    vi.useRealTimers();
  });

  it('supports idempotent pause/resume calls without duplicate completion', () => {
    vi.useFakeTimers();

    const { callbacks, spies } = createCallbacks();
    const buffer = new StreamBuffer(callbacks, {
      tickMs: 10,
      charsPerTick: 2,
    });

    buffer.pushAgentStart({
      messageId: 'm-2',
      agentId: 'teacher-1',
      agentName: 'Teacher',
    });
    buffer.pushText('m-2', 'reliable stream');
    buffer.sealText('m-2');
    buffer.pushDone({ totalActions: 0, totalAgents: 1, agentHadContent: true });

    buffer.start();

    buffer.pause();
    buffer.pause();
    buffer.pause();

    vi.advanceTimersByTime(150);
    expect(spies.onDone).not.toHaveBeenCalled();

    buffer.resume();
    buffer.resume();

    vi.advanceTimersByTime(300);

    expect(spies.onDone).toHaveBeenCalledTimes(1);
    expect(spies.onError).not.toHaveBeenCalled();

    buffer.dispose();
    vi.useRealTimers();
  });

  it('resolves waitUntilDrained even if done already fired', async () => {
    const { callbacks } = createCallbacks();
    const buffer = new StreamBuffer(callbacks, {
      tickMs: 10,
      charsPerTick: 5,
    });

    buffer.pushAgentStart({
      messageId: 'm-3',
      agentId: 'teacher-1',
      agentName: 'Teacher',
    });
    buffer.pushText('m-3', 'done');
    buffer.sealText('m-3');
    buffer.pushDone({ totalActions: 0, totalAgents: 1, agentHadContent: true });

    buffer.flush();

    await expect(buffer.waitUntilDrained()).resolves.toBeUndefined();

    buffer.dispose();
  });
});
