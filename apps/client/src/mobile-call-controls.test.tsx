import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileCallControls } from './mobile-call-controls.js';

afterEach(() => {
  cleanup();
});

describe('MobileCallControls', () => {
  it('renders default labels and triggers callbacks', () => {
    const onToggleMute = vi.fn();
    const onToggleCamera = vi.fn();
    const onToggleScreenShare = vi.fn();
    const onOpenChat = vi.fn();

    render(
      <MobileCallControls
        isMuted={false}
        isCameraOff={false}
        isScreenSharing={false}
        onToggleMute={onToggleMute}
        onToggleCamera={onToggleCamera}
        onToggleScreenShare={onToggleScreenShare}
        onOpenChat={onOpenChat}
      />
    );

    const muteButton = screen.getByRole('button', { name: 'Mute' });
    const cameraButton = screen.getByRole('button', { name: 'Camera off' });
    const shareButton = screen.getByRole('button', { name: 'Share' });
    expect(muteButton.getAttribute('aria-pressed')).toBe('false');
    expect(cameraButton.getAttribute('aria-pressed')).toBe('true');
    expect(shareButton.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(muteButton);
    fireEvent.click(cameraButton);
    fireEvent.click(shareButton);
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));

    expect(onToggleMute).toHaveBeenCalledTimes(1);
    expect(onToggleCamera).toHaveBeenCalledTimes(1);
    expect(onToggleScreenShare).toHaveBeenCalledTimes(1);
    expect(onOpenChat).toHaveBeenCalledTimes(1);
  });

  it('renders active-state labels', () => {
    render(
      <MobileCallControls
        isMuted
        isCameraOff
        isScreenSharing
        onToggleMute={vi.fn()}
        onToggleCamera={vi.fn()}
        onToggleScreenShare={vi.fn()}
        onOpenChat={vi.fn()}
      />
    );

    const unmuteButton = screen.getByRole('button', { name: 'Unmute' });
    const cameraOnButton = screen.getByRole('button', { name: 'Camera on' });
    const stopShareButton = screen.getByRole('button', { name: 'Stop share' });

    expect(unmuteButton).toBeTruthy();
    expect(cameraOnButton).toBeTruthy();
    expect(stopShareButton).toBeTruthy();
    expect(unmuteButton.getAttribute('aria-pressed')).toBe('true');
    expect(cameraOnButton.getAttribute('aria-pressed')).toBe('false');
    expect(stopShareButton.getAttribute('aria-pressed')).toBe('true');
  });
});
