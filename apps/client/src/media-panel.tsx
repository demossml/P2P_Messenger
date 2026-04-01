import React, { useMemo, useState } from 'react';
import { useVoiceActivity } from './use-voice-activity.js';
import { VideoView } from './video-view.js';

type RemoteStreamEntry = {
  peerId: string;
  stream: MediaStream;
};

type MediaPanelProps = {
  localStream: MediaStream | null;
  remoteStreams: RemoteStreamEntry[];
  preferredAudioOutputId: string;
  peerConnectionQualities: Array<{
    peerId: string;
    quality: 'good' | 'fair' | 'poor';
    packetLossPercent: number;
    rttMs: number | null;
    jitterMs: number | null;
  }>;
};

function gridColumns(tileCount: number): number {
  if (tileCount <= 1) {
    return 1;
  }
  if (tileCount <= 4) {
    return 2;
  }
  return 3;
}

function qualityLabel(value: 'good' | 'fair' | 'poor'): string {
  return value;
}

function formatPeerMetrics(entry: {
  packetLossPercent: number;
  rttMs: number | null;
  jitterMs: number | null;
}): string {
  const rtt = entry.rttMs === null ? 'n/a' : `${Math.round(entry.rttMs)} ms`;
  const jitter = entry.jitterMs === null ? 'n/a' : `${Math.round(entry.jitterMs)} ms`;
  return `Loss: ${entry.packetLossPercent.toFixed(1)}% | RTT: ${rtt} | Jitter: ${jitter}`;
}

function qualityRank(value: 'good' | 'fair' | 'poor' | null): number {
  if (value === 'poor') {
    return 0;
  }
  if (value === 'fair') {
    return 1;
  }
  if (value === 'good') {
    return 2;
  }
  return 3;
}

export function MediaPanel({
  localStream,
  remoteStreams,
  preferredAudioOutputId,
  peerConnectionQualities
}: MediaPanelProps): React.JSX.Element {
  const { activeSpeakerPeerId } = useVoiceActivity(remoteStreams);
  const [showIssuesOnly, setShowIssuesOnly] = useState<boolean>(false);
  const [sortMode, setSortMode] = useState<'joined' | 'quality'>('joined');

  const remoteStreamMap = useMemo(
    () => new Map(remoteStreams.map((entry) => [entry.peerId, entry.stream])),
    [remoteStreams]
  );
  const qualityByPeerId = useMemo(
    () => new Map(peerConnectionQualities.map((entry) => [entry.peerId, entry])),
    [peerConnectionQualities]
  );
  const visibleRemoteEntries = useMemo(() => {
    const candidates = remoteStreams.filter((entry) => {
      if (!showIssuesOnly) {
        return true;
      }

      const quality = qualityByPeerId.get(entry.peerId)?.quality;
      return quality === 'fair' || quality === 'poor';
    });

    if (sortMode === 'joined') {
      return candidates;
    }

    return [...candidates].sort((left, right) => {
      const leftQuality = qualityByPeerId.get(left.peerId)?.quality ?? null;
      const rightQuality = qualityByPeerId.get(right.peerId)?.quality ?? null;
      const byQuality = qualityRank(leftQuality) - qualityRank(rightQuality);
      if (byQuality !== 0) {
        return byQuality;
      }

      return left.peerId.localeCompare(right.peerId);
    });
  }, [qualityByPeerId, remoteStreams, showIssuesOnly, sortMode]);

  const visiblePeerIds = useMemo(
    () => new Set(visibleRemoteEntries.map((entry) => entry.peerId)),
    [visibleRemoteEntries]
  );
  const localIsDominant =
    activeSpeakerPeerId === null || !visiblePeerIds.has(activeSpeakerPeerId);
  const totalTiles = (localStream ? 1 : 0) + visibleRemoteEntries.length;
  const columns = gridColumns(totalTiles);

  return (
    <>
      <section>
        <h2>Local</h2>
        {localStream ? (
          <VideoView
            stream={localStream}
            muted
            label="You"
            isHighlighted={localIsDominant}
            {...(localIsDominant ? { badge: 'Dominant speaker' } : {})}
          />
        ) : (
          <p>No local video yet.</p>
        )}
      </section>

      <section>
        <h2>Remote</h2>
        {remoteStreams.length === 0 ? <p>No remote streams yet.</p> : null}
        {remoteStreams.length > 0 ? (
          <div style={{ marginBottom: '10px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => {
                setShowIssuesOnly((current) => !current);
              }}
            >
              {showIssuesOnly ? 'Show all peers' : 'Show issues only'}
            </button>
            <label htmlFor="remote-sort-mode">Sort</label>
            <select
              id="remote-sort-mode"
              value={sortMode}
              onChange={(event) => {
                const next = event.target.value === 'quality' ? 'quality' : 'joined';
                setSortMode(next);
              }}
            >
              <option value="joined">Join order</option>
              <option value="quality">Quality (poor first)</option>
            </select>
            <span
              title="good quality peers"
              aria-label="Quality legend: good connection"
              style={{ padding: '2px 8px', borderRadius: '999px', background: '#14532d', color: '#dcfce7' }}
            >
              good
            </span>
            <span
              title="fair quality peers"
              aria-label="Quality legend: fair connection"
              style={{ padding: '2px 8px', borderRadius: '999px', background: '#78350f', color: '#fef3c7' }}
            >
              fair
            </span>
            <span
              title="poor quality peers"
              aria-label="Quality legend: poor connection"
              style={{ padding: '2px 8px', borderRadius: '999px', background: '#7f1d1d', color: '#fee2e2' }}
            >
              poor
            </span>
          </div>
        ) : null}
        {visibleRemoteEntries.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, minmax(220px, 1fr))`,
              gap: '10px'
            }}
          >
            {visibleRemoteEntries.map((entry) => {
              const stream = remoteStreamMap.get(entry.peerId);
              if (!stream) {
                return null;
              }

              const isDominant = activeSpeakerPeerId === entry.peerId;
              const peerQuality = qualityByPeerId.get(entry.peerId);
              const quality = peerQuality?.quality;
              const badgeParts = [isDominant ? 'Speaking' : null, quality ? qualityLabel(quality) : 'checking']
                .filter((part): part is string => part !== null)
                .join(' • ');
              const metricsText = peerQuality ? formatPeerMetrics(peerQuality) : 'Collecting metrics...';
              const badgeAriaLabel = `${entry.peerId.slice(0, 8)} quality badge: ${badgeParts}. ${metricsText}`;
              return (
                <VideoView
                  key={entry.peerId}
                  stream={stream}
                  label={`Peer ${entry.peerId.slice(0, 8)}`}
                  isHighlighted={isDominant}
                  badge={badgeParts}
                  badgeTone={quality ?? 'neutral'}
                  badgeTitle={metricsText}
                  badgeAriaLabel={badgeAriaLabel}
                  audioOutputId={preferredAudioOutputId}
                />
              );
            })}
          </div>
        ) : remoteStreams.length > 0 ? (
          <p>No peers match current quality filter.</p>
        ) : null}
      </section>
    </>
  );
}
