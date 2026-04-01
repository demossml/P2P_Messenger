import { describe, expect, it } from 'vitest';
import { assessConnectionQuality } from './connection-quality.js';

describe('assessConnectionQuality', () => {
  it('returns good quality for stable metrics', () => {
    const result = assessConnectionQuality(
      {
        packetsSent: 1000,
        packetsLost: 10,
        rttMs: 80,
        jitterMs: 10
      },
      6000
    );

    expect(result.quality).toBe('good');
    expect(result.shouldWarn).toBe(false);
    expect(result.shouldForceRelay).toBe(false);
  });

  it('returns fair quality when packet loss is above 5%', () => {
    const result = assessConnectionQuality(
      {
        packetsSent: 100,
        packetsLost: 7,
        rttMs: 120,
        jitterMs: 12
      },
      7000
    );

    expect(result.quality).toBe('fair');
    expect(result.shouldWarn).toBe(true);
    expect(result.shouldForceRelay).toBe(false);
  });

  it('returns poor quality and suggests relay fallback after 5 seconds', () => {
    const result = assessConnectionQuality(
      {
        packetsSent: 100,
        packetsLost: 20,
        rttMs: 650,
        jitterMs: 150
      },
      8000
    );

    expect(result.quality).toBe('poor');
    expect(result.shouldWarn).toBe(true);
    expect(result.shouldForceRelay).toBe(true);
  });

  it('does not suggest relay fallback before timeout threshold', () => {
    const result = assessConnectionQuality(
      {
        packetsSent: 100,
        packetsLost: 25,
        rttMs: 620,
        jitterMs: 120
      },
      2000
    );

    expect(result.quality).toBe('poor');
    expect(result.shouldForceRelay).toBe(false);
  });
});
