import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIsMobileViewport } from './use-is-mobile-viewport.js';

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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useIsMobileViewport', () => {
  it('returns initial value from matchMedia', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useIsMobileViewport());
    expect(result.current).toBe(true);
  });

  it('updates value on media query change', () => {
    const matchMedia = installMatchMedia(false);
    const { result } = renderHook(() => useIsMobileViewport());
    expect(result.current).toBe(false);

    act(() => {
      matchMedia.setMatches(true);
    });
    expect(result.current).toBe(true);
  });
});
