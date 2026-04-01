import React from 'react';
import { StatusNotice } from './status-notice.js';

type ConnectionPanelProps = {
  status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';
  roomId: string;
  isLocalMediaReady: boolean;
  remotePeerCount: number;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  connectionQuality: 'good' | 'fair' | 'poor';
  packetLossPercent: number;
  rttMs: number | null;
  jitterMs: number | null;
  relayFallbackRecommended: boolean;
  relayModeEnabled: boolean;
  onRoomIdChange: (value: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
};

export function ConnectionPanel({
  status,
  roomId,
  isLocalMediaReady,
  remotePeerCount,
  isMuted,
  isCameraOff,
  isScreenSharing,
  connectionQuality,
  packetLossPercent,
  rttMs,
  jitterMs,
  relayFallbackRecommended,
  relayModeEnabled,
  onRoomIdChange,
  onConnect,
  onDisconnect,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare
}: ConnectionPanelProps): React.JSX.Element {
  return (
    <section>
      <StatusNotice label="Connection updates">
        <p>Signaling status: {status}</p>
        <p>Connection quality: {connectionQuality}</p>
      </StatusNotice>
      <p>Local media: {isLocalMediaReady ? 'ready' : 'not ready'}</p>
      <p>Remote peers: {remotePeerCount}</p>
      <p>Microphone: {isMuted ? 'muted' : 'on'}</p>
      <p>Camera: {isCameraOff ? 'off' : 'on'}</p>
      <p>Screen share: {isScreenSharing ? 'on' : 'off'}</p>
      <p>Packet loss: {packetLossPercent.toFixed(1)}%</p>
      <p>RTT: {rttMs === null ? 'n/a' : `${Math.round(rttMs)} ms`}</p>
      <p>Jitter: {jitterMs === null ? 'n/a' : `${Math.round(jitterMs)} ms`}</p>
      <p>Relay fallback: {relayFallbackRecommended ? 'recommended' : 'not needed'}</p>
      <p>Relay mode: {relayModeEnabled ? 'on' : 'off'}</p>
      <label htmlFor="roomId">Room ID</label>
      <input
        id="roomId"
        value={roomId}
        onChange={(event) => {
          onRoomIdChange(event.target.value);
        }}
        placeholder="room-123"
      />
      <div>
        <button type="button" onClick={onConnect}>
          Connect
        </button>
        <button type="button" onClick={onDisconnect}>
          Disconnect
        </button>
        <button type="button" onClick={onToggleMute}>
          Toggle mute
        </button>
        <button type="button" onClick={onToggleCamera}>
          Toggle camera
        </button>
        <button type="button" onClick={onToggleScreenShare}>
          {isScreenSharing ? 'Stop share' : 'Share screen'}
        </button>
      </div>
    </section>
  );
}
