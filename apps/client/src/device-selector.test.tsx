import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceSelector } from './device-selector.js';

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DeviceSelector', () => {
  it('renders fallback when mediaDevices API is unavailable', () => {
    const originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', {
      value: undefined,
      configurable: true
    });

    render(
      <DeviceSelector
        preferredDevices={{ audioInputId: '', videoInputId: '', audioOutputId: '' }}
        onChangePreferredDevices={vi.fn()}
      />
    );

    expect(screen.getByText('Media device API is unavailable in this browser.')).toBeTruthy();
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true
    });
  });

  it('renders devices and emits preference changes', async () => {
    const stopTrack = vi.fn();
    const fakeStream = {
      getTracks: () => [{ stop: stopTrack }]
    } as unknown as MediaStream;

    const enumerateDevices = vi.fn().mockResolvedValue([
      {
        deviceId: 'cam-1',
        kind: 'videoinput',
        label: 'Front camera'
      },
      {
        deviceId: 'mic-1',
        kind: 'audioinput',
        label: 'Desk mic'
      },
      {
        deviceId: 'spk-1',
        kind: 'audiooutput',
        label: 'USB speaker'
      }
    ] as MediaDeviceInfo[]);
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream);
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const originalMediaDevices = navigator.mediaDevices;
    const originalPermissions = navigator.permissions;

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices,
        getUserMedia,
        addEventListener,
        removeEventListener
      },
      configurable: true
    });
    Object.defineProperty(navigator, 'permissions', {
      value: {
        query: vi.fn(async ({ name }: { name: string }) => ({
          state: name === 'camera' ? 'denied' : 'prompt',
          onchange: null
        }))
      },
      configurable: true
    });

    const onChangePreferredDevices = vi.fn();
    render(
      <DeviceSelector
        preferredDevices={{ audioInputId: '', videoInputId: '', audioOutputId: '' }}
        onChangePreferredDevices={onChangePreferredDevices}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Front camera')).toBeTruthy();
    });
    expect(screen.getByRole('progressbar', { name: 'Mic level' })).toBeTruthy();
    expect(screen.getByText('Camera permission: denied')).toBeTruthy();
    expect(screen.getByText('Microphone permission: prompt')).toBeTruthy();
    expect(
      screen.getByRole('alert', { name: 'Device permissions blocked' }).textContent
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Camera or microphone is blocked. Allow access in browser site settings, then refresh.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText('Input too low. Move closer to microphone or increase gain.')
    ).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Microphone level status' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Camera'), { target: { value: 'cam-1' } });
    fireEvent.change(screen.getByLabelText('Microphone'), { target: { value: 'mic-1' } });
    fireEvent.change(screen.getByLabelText('Speaker'), { target: { value: 'spk-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request permissions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play test tone' }));

    expect(onChangePreferredDevices).toHaveBeenCalledWith({ videoInputId: 'cam-1' });
    expect(onChangePreferredDevices).toHaveBeenCalledWith({ audioInputId: 'mic-1' });
    expect(onChangePreferredDevices).toHaveBeenCalledWith({ audioOutputId: 'spk-1' });
    await waitFor(() => {
      expect(
        getUserMedia.mock.calls.some(
          (args: unknown[]) => {
            const constraints = args[0] as MediaStreamConstraints | undefined;
            return constraints?.audio === true && constraints?.video === true;
          }
        )
      ).toBe(true);
    });
    expect(screen.getByRole('status', { name: 'Test tone status' })).toBeTruthy();
    expect(screen.getByText('Test tone is not supported in this browser.')).toBeTruthy();
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true
    });
    Object.defineProperty(navigator, 'permissions', {
      value: originalPermissions,
      configurable: true
    });
  });
});
