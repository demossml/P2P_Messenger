import React from 'react';
import { mobileCallControlsStyle } from './mobile-styles.js';

type MobileCallControlsProps = {
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onOpenChat: () => void;
};

export function MobileCallControls({
  isMuted,
  isCameraOff,
  isScreenSharing,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
  onOpenChat
}: MobileCallControlsProps): React.JSX.Element {
  return (
    <nav
      aria-label="Call controls"
      style={mobileCallControlsStyle()}
    >
      <button type="button" aria-pressed={isMuted} onClick={onToggleMute}>
        {isMuted ? 'Unmute' : 'Mute'}
      </button>
      <button type="button" aria-pressed={!isCameraOff} onClick={onToggleCamera}>
        {isCameraOff ? 'Camera on' : 'Camera off'}
      </button>
      <button type="button" aria-pressed={isScreenSharing} onClick={onToggleScreenShare}>
        {isScreenSharing ? 'Stop share' : 'Share'}
      </button>
      <button type="button" onClick={onOpenChat}>
        Chat
      </button>
    </nav>
  );
}
