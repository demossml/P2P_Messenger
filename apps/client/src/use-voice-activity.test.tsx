import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceActivity } from './use-voice-activity.js';

type FakeStream = MediaStream & {
  level: number;
};

type FakeAnalyzerNode = {
  fftSize: number;
  frequencyBinCount: number;
  disconnect: () => void;
  getByteFrequencyData: (buffer: Uint8Array) => void;
};

type FakeMediaStreamAudioSourceNode = {
  connect: (_node: FakeAnalyzerNode) => void;
  disconnect: () => void;
};

type FakeAudioContext = {
  createMediaStreamSource: (stream: MediaStream) => FakeMediaStreamAudioSourceNode;
  createAnalyser: () => FakeAnalyzerNode;
  close: () => Promise<void>;
};

function createFakeAudioContext(): FakeAudioContext {
  const streamByAnalyzer = new WeakMap<FakeAnalyzerNode, FakeStream>();
  let pendingStream: FakeStream | null = null;

  return {
    createMediaStreamSource(stream: MediaStream) {
      pendingStream = stream as FakeStream;
      return {
        connect: (node: FakeAnalyzerNode) => {
          if (pendingStream) {
            streamByAnalyzer.set(node, pendingStream);
          }
        },
        disconnect: () => undefined
      };
    },
    createAnalyser() {
      const analyzer: FakeAnalyzerNode = {
        fftSize: 0,
        frequencyBinCount: 16,
        disconnect: () => undefined,
        getByteFrequencyData(buffer: Uint8Array) {
          const level = streamByAnalyzer.get(analyzer)?.level ?? 0;
          buffer.fill(level);
        }
      };
      return analyzer;
    },
    close: vi.fn(async () => undefined)
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useVoiceActivity', () => {
  it('returns null when there are no remote streams', () => {
    const { result } = renderHook(() =>
      useVoiceActivity([], {
        createAudioContext: () => createFakeAudioContext() as unknown as AudioContext
      })
    );

    expect(result.current.activeSpeakerPeerId).toBeNull();
  });

  it('selects loudest peer above threshold and drops to null when quiet', () => {
    const streamA = { level: 12 } as FakeStream;
    const streamB = { level: 36 } as FakeStream;

    const { result } = renderHook(() =>
      useVoiceActivity(
        [
          { peerId: 'peer-a', stream: streamA },
          { peerId: 'peer-b', stream: streamB }
        ],
        {
          intervalMs: 200,
          minAverageLevel: 18,
          createAudioContext: () => createFakeAudioContext() as unknown as AudioContext
        }
      )
    );

    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(result.current.activeSpeakerPeerId).toBe('peer-b');

    streamA.level = 3;
    streamB.level = 4;

    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(result.current.activeSpeakerPeerId).toBeNull();
  });
});
