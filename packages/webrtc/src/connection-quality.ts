export type ConnectionSample = {
  packetsSent: number;
  packetsLost: number;
  rttMs: number;
  jitterMs: number;
};

export type ConnectionQuality = 'good' | 'fair' | 'poor';

export type ConnectionAssessment = {
  packetLossPercent: number;
  quality: ConnectionQuality;
  shouldWarn: boolean;
  shouldForceRelay: boolean;
};

export function assessConnectionQuality(
  sample: ConnectionSample,
  connectionAgeMs: number
): ConnectionAssessment {
  const packetLossPercent =
    sample.packetsSent > 0 ? (sample.packetsLost / sample.packetsSent) * 100 : 0;

  const poorByStats = packetLossPercent > 10 || sample.rttMs > 500 || sample.jitterMs > 100;
  const fairByStats = packetLossPercent > 5 || sample.rttMs > 300 || sample.jitterMs > 50;

  const quality: ConnectionQuality = poorByStats ? 'poor' : fairByStats ? 'fair' : 'good';
  const shouldWarn = fairByStats;
  const shouldForceRelay = connectionAgeMs >= 5000 && poorByStats;

  return {
    packetLossPercent,
    quality,
    shouldWarn,
    shouldForceRelay
  };
}
