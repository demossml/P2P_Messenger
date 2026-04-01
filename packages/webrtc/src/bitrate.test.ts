import { describe, expect, it, vi } from 'vitest';
import { setVideoBitrate } from './bitrate.js';

describe('setVideoBitrate', () => {
  it('sets maxBitrate on the first encoding in bps', async () => {
    const setParameters = vi.fn<(_: RTCRtpSendParameters) => Promise<void>>().mockResolvedValue();
    const sender = {
      getParameters: () =>
        ({
          encodings: [{ maxBitrate: 128000 }]
        }) as RTCRtpSendParameters,
      setParameters
    } as unknown as RTCRtpSender;

    await setVideoBitrate(sender, 512);

    expect(setParameters).toHaveBeenCalledTimes(1);
    expect(setParameters).toHaveBeenCalledWith({
      encodings: [{ maxBitrate: 512000 }]
    });
  });

  it('creates encoding entry when sender has no encodings yet', async () => {
    const setParameters = vi.fn<(_: RTCRtpSendParameters) => Promise<void>>().mockResolvedValue();
    const sender = {
      getParameters: () => ({}) as RTCRtpSendParameters,
      setParameters
    } as unknown as RTCRtpSender;

    await setVideoBitrate(sender, 64);

    expect(setParameters).toHaveBeenCalledWith({
      encodings: [{ maxBitrate: 64000 }]
    });
  });

  it('clamps bitrate to at least 1 kbps', async () => {
    const setParameters = vi.fn<(_: RTCRtpSendParameters) => Promise<void>>().mockResolvedValue();
    const sender = {
      getParameters: () => ({ encodings: [{}] }) as RTCRtpSendParameters,
      setParameters
    } as unknown as RTCRtpSender;

    await setVideoBitrate(sender, 0);

    expect(setParameters).toHaveBeenCalledWith({
      encodings: [{ maxBitrate: 1000 }]
    });
  });
});
