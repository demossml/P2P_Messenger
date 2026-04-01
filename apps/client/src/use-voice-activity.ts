import { useEffect, useState } from 'react';

export type VoiceActivityStreamEntry = {
  peerId: string;
  stream: MediaStream;
};

type UseVoiceActivityOptions = {
  intervalMs?: number;
  minAverageLevel?: number;
  createAudioContext?: () => AudioContext | null;
};

type UseVoiceActivityResult = {
  activeSpeakerPeerId: string | null;
};

function createDefaultAudioContext(): AudioContext | null {
  const AudioContextCtor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }
  return new AudioContextCtor();
}

export function useVoiceActivity(
  remoteStreams: VoiceActivityStreamEntry[],
  options?: UseVoiceActivityOptions
): UseVoiceActivityResult {
  const [activeSpeakerPeerId, setActiveSpeakerPeerId] = useState<string | null>(null);
  const intervalMs = options?.intervalMs ?? 400;
  const minAverageLevel = options?.minAverageLevel ?? 18;
  const createAudioContext = options?.createAudioContext ?? createDefaultAudioContext;

  useEffect(() => {
    if (remoteStreams.length === 0) {
      setActiveSpeakerPeerId(null);
      return;
    }

    const audioContext = createAudioContext();
    if (!audioContext) {
      setActiveSpeakerPeerId(null);
      return;
    }

    const analyzers = remoteStreams
      .map((entry) => {
        try {
          const source = audioContext.createMediaStreamSource(entry.stream);
          const analyzer = audioContext.createAnalyser();
          analyzer.fftSize = 512;
          source.connect(analyzer);
          return {
            peerId: entry.peerId,
            source,
            analyzer,
            buffer: new Uint8Array(analyzer.frequencyBinCount)
          };
        } catch {
          return null;
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    if (analyzers.length === 0) {
      setActiveSpeakerPeerId(null);
      void audioContext.close();
      return;
    }

    const intervalId = window.setInterval(() => {
      let loudestPeerId: string | null = null;
      let loudestScore = 0;

      for (const entry of analyzers) {
        entry.analyzer.getByteFrequencyData(entry.buffer);
        const sum = entry.buffer.reduce((acc, value) => acc + value, 0);
        const average = sum / Math.max(1, entry.buffer.length);
        if (average > loudestScore) {
          loudestScore = average;
          loudestPeerId = entry.peerId;
        }
      }

      setActiveSpeakerPeerId(loudestScore > minAverageLevel ? loudestPeerId : null);
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
      for (const entry of analyzers) {
        try {
          entry.source.disconnect();
          entry.analyzer.disconnect();
        } catch {
          // Ignore cleanup errors.
        }
      }
      void audioContext.close();
    };
  }, [createAudioContext, intervalMs, minAverageLevel, remoteStreams]);

  return { activeSpeakerPeerId };
}
