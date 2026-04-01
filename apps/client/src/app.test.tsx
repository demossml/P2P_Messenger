import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app.js';

const signalingSpies = {
  setRoomId: vi.fn(),
  setPreferredDevices: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  toggleMute: vi.fn(),
  toggleCamera: vi.fn(),
  toggleScreenShare: vi.fn(async () => undefined),
  sendChatText: vi.fn(),
  sendReaction: vi.fn(),
  sendFile: vi.fn()
};
const signalingState = {
  lastError: null as string | null
};

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: {
    message: vi.fn()
  }
}));

vi.mock('./use-signaling.js', () => ({
  useSignaling: () => ({
    status: 'idle',
    roomId: 'room-1',
    setRoomId: signalingSpies.setRoomId,
    remotePeerCount: 0,
    localStream: null,
    remoteStreams: [],
    isLocalMediaReady: false,
    isMuted: false,
    isCameraOff: false,
    isScreenSharing: false,
    connectionQuality: 'good',
    packetLossPercent: 0,
    rttMs: null,
    jitterMs: null,
    relayFallbackRecommended: false,
    relayModeEnabled: false,
    networkNotice: null,
    peerConnectionQualities: [],
    preferredDevices: {
      audioInputId: '',
      videoInputId: '',
      audioOutputId: ''
    },
    setPreferredDevices: signalingSpies.setPreferredDevices,
    chatMessages: [],
    fileTransfers: [],
    localFingerprint: null,
    remoteFingerprints: [],
    lastError: signalingState.lastError,
    connect: signalingSpies.connect,
    disconnect: signalingSpies.disconnect,
    toggleMute: signalingSpies.toggleMute,
    toggleCamera: signalingSpies.toggleCamera,
    toggleScreenShare: signalingSpies.toggleScreenShare,
    sendChatText: signalingSpies.sendChatText,
    sendReaction: signalingSpies.sendReaction,
    sendFile: signalingSpies.sendFile
  })
}));

vi.mock('./use-fingerprint-verification.js', () => ({
  useFingerprintVerification: () => ({
    copiedFingerprint: null,
    securityNotice: null,
    verifiedPeers: {},
    markPeerVerification: vi.fn(),
    clearPeerVerification: vi.fn(),
    resetAllVerifications: vi.fn(),
    copyFingerprint: vi.fn(async () => undefined)
  })
}));

type MediaQueryStub = {
  setMatches: (next: boolean) => void;
};

function installMatchMedia(initialMatches: boolean): MediaQueryStub {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      get matches() {
        return matches;
      },
      media: '(max-width: 900px)',
      onchange: null,
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      addListener: (listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeListener: (listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => true
    }))
  });

  return {
    setMatches(next: boolean) {
      matches = next;
      for (const listener of listeners) {
        listener({ matches: next } as MediaQueryListEvent);
      }
    }
  };
}

beforeEach(() => {
  installMatchMedia(false);
  signalingState.lastError = null;
  for (const spy of Object.values(signalingSpies)) {
    spy.mockClear();
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('renders inline chat on desktop viewport', () => {
    installMatchMedia(false);
    render(<App />);

    expect(screen.getByText('Chat')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Swipe up for chat' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Call controls' })).toBeNull();
  });

  it('renders mobile chat sheet toggle and allows open/close by button', () => {
    installMatchMedia(true);
    render(<App />);

    const toggle = screen.getByRole('button', { name: 'Swipe up for chat' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Close chat' }).getAttribute('aria-expanded')).toBe(
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    expect(screen.getByRole('button', { name: 'Swipe up for chat' })).toBeTruthy();
  });

  it('opens and closes mobile chat sheet by swipe gesture', () => {
    installMatchMedia(true);
    render(<App />);

    const toggle = screen.getByRole('button', { name: 'Swipe up for chat' });

    fireEvent.touchStart(toggle, {
      touches: [{ clientY: 220 }]
    });
    fireEvent.touchEnd(toggle, {
      changedTouches: [{ clientY: 120 }]
    });
    expect(screen.getByRole('button', { name: 'Close chat' })).toBeTruthy();

    const openedToggle = screen.getByRole('button', { name: 'Close chat' });
    fireEvent.touchStart(openedToggle, {
      touches: [{ clientY: 120 }]
    });
    fireEvent.touchEnd(openedToggle, {
      changedTouches: [{ clientY: 240 }]
    });
    expect(screen.getByRole('button', { name: 'Swipe up for chat' })).toBeTruthy();
  });

  it('uses mobile call controls and opens chat from control bar', () => {
    installMatchMedia(true);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    fireEvent.click(screen.getByRole('button', { name: 'Camera off' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));

    expect(signalingSpies.toggleMute).toHaveBeenCalledTimes(1);
    expect(signalingSpies.toggleCamera).toHaveBeenCalledTimes(1);
    expect(signalingSpies.toggleScreenShare).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Close chat' })).toBeTruthy();
  });

  it('renders application error as alert notice', () => {
    signalingState.lastError = 'Signaling connection failed.';
    render(<App />);

    const alert = screen.getByRole('alert', { name: 'Application error' });
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain('Signaling connection failed.');
  });
});
