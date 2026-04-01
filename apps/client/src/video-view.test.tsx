import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoView } from './video-view.js';

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VideoView', () => {
  it('applies selected audio output device for remote streams when supported', async () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
      value: setSinkId,
      configurable: true
    });

    render(<VideoView stream={{} as MediaStream} label="Peer 1" audioOutputId="spk-1" />);

    expect(setSinkId).toHaveBeenCalledWith('spk-1');
  });

  it('does not apply sink id for muted local stream', () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
      value: setSinkId,
      configurable: true
    });

    render(
      <VideoView
        stream={{} as MediaStream}
        label="You"
        muted
        audioOutputId="spk-1"
      />
    );

    expect(setSinkId).not.toHaveBeenCalled();
  });
});
