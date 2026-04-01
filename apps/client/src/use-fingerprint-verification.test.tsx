import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFingerprintVerification } from './use-fingerprint-verification.js';

const STORAGE_KEY = 'p2p.verifiedPeers';

describe('useFingerprintVerification', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('loads verified peers from sessionStorage', () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        peerA: true,
        peerB: false
      })
    );

    const { result } = renderHook(() =>
      useFingerprintVerification([{ peerId: 'peerA' }, { peerId: 'peerB' }])
    );

    expect(result.current.verifiedPeers).toEqual({
      peerA: true,
      peerB: false
    });
  });

  it('removes stale peer entries that are no longer active', async () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activePeer: true,
        stalePeer: false
      })
    );

    const { result } = renderHook(() =>
      useFingerprintVerification([{ peerId: 'activePeer' }])
    );

    await waitFor(() => {
      expect(result.current.verifiedPeers).toEqual({
        activePeer: true
      });
    });
  });

  it('marks, clears, and resets peer verification state', async () => {
    const { result } = renderHook(() =>
      useFingerprintVerification([{ peerId: 'peerOne' }, { peerId: 'peerTwo' }])
    );

    act(() => {
      result.current.markPeerVerification('peerOne', true);
      result.current.markPeerVerification('peerTwo', false);
    });

    expect(result.current.verifiedPeers).toEqual({
      peerOne: true,
      peerTwo: false
    });
    expect(result.current.securityNotice).toContain('unmatched');

    act(() => {
      result.current.clearPeerVerification('peerTwo');
    });
    expect(result.current.verifiedPeers).toEqual({
      peerOne: true
    });

    act(() => {
      result.current.resetAllVerifications();
    });
    expect(result.current.verifiedPeers).toEqual({});
  });

  it('copies fingerprint and clears transient states after timers', async () => {
    vi.useFakeTimers();
    const writeTextMock = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: writeTextMock
      }
    });

    const { result } = renderHook(() =>
      useFingerprintVerification([{ peerId: 'peerOne' }])
    );

    await act(async () => {
      await result.current.copyFingerprint('abc123');
    });

    expect(writeTextMock).toHaveBeenCalledWith('abc123');
    expect(result.current.copiedFingerprint).toBe('abc123');
    expect(result.current.securityNotice).toContain('copied');

    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(result.current.copiedFingerprint).toBeNull();

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.securityNotice).toBeNull();
  });
});
