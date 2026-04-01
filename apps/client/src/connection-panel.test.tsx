import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionPanel } from './connection-panel.js';

afterEach(() => {
  cleanup();
});

describe('ConnectionPanel', () => {
  it('renders connection metrics', () => {
    render(
      <ConnectionPanel
        status="connected"
        roomId="room-42"
        isLocalMediaReady
        remotePeerCount={2}
        isMuted={false}
        isCameraOff={false}
        isScreenSharing={false}
        connectionQuality="fair"
        packetLossPercent={6.4}
        rttMs={320}
        jitterMs={55}
        relayFallbackRecommended
        relayModeEnabled
        onRoomIdChange={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onToggleMute={vi.fn()}
        onToggleCamera={vi.fn()}
        onToggleScreenShare={vi.fn()}
      />
    );

    expect(screen.getByRole('status', { name: 'Connection updates' })).toBeTruthy();
    expect(screen.getByText('Connection quality: fair')).toBeTruthy();
    expect(screen.getByText('Packet loss: 6.4%')).toBeTruthy();
    expect(screen.getByText('RTT: 320 ms')).toBeTruthy();
    expect(screen.getByText('Jitter: 55 ms')).toBeTruthy();
    expect(screen.getByText('Relay fallback: recommended')).toBeTruthy();
    expect(screen.getByText('Relay mode: on')).toBeTruthy();
  });

  it('invokes callbacks for connect/disconnect/toggles', () => {
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    const onToggleMute = vi.fn();
    const onToggleCamera = vi.fn();
    const onToggleScreenShare = vi.fn();
    const onRoomIdChange = vi.fn();

    render(
      <ConnectionPanel
        status="idle"
        roomId=""
        isLocalMediaReady={false}
        remotePeerCount={0}
        isMuted={false}
        isCameraOff={false}
        isScreenSharing={false}
        connectionQuality="good"
        packetLossPercent={0}
        rttMs={null}
        jitterMs={null}
        relayFallbackRecommended={false}
        relayModeEnabled={false}
        onRoomIdChange={onRoomIdChange}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onToggleMute={onToggleMute}
        onToggleCamera={onToggleCamera}
        onToggleScreenShare={onToggleScreenShare}
      />
    );

    fireEvent.change(screen.getByLabelText('Room ID'), { target: { value: 'room-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle mute' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle camera' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share screen' }));

    expect(onRoomIdChange).toHaveBeenCalledWith('room-a');
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(onToggleMute).toHaveBeenCalledTimes(1);
    expect(onToggleCamera).toHaveBeenCalledTimes(1);
    expect(onToggleScreenShare).toHaveBeenCalledTimes(1);
  });
});
