import React, { useEffect, useRef, useState } from 'react';
import { AlertNotice } from './alert-notice.js';
import { StatusNotice } from './status-notice.js';

type PreferredDevices = {
  audioInputId: string;
  videoInputId: string;
  audioOutputId: string;
};

type DeviceSelectorProps = {
  preferredDevices: PreferredDevices;
  onChangePreferredDevices: (next: Partial<PreferredDevices>) => void;
};

type DeviceGroups = {
  audioInputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
};

type MicLevelStatus = 'low' | 'good' | 'high';
type PermissionStateView = 'granted' | 'denied' | 'prompt' | 'unknown';

function groupDevices(devices: MediaDeviceInfo[]): DeviceGroups {
  const audioInputs = devices.filter((device) => device.kind === 'audioinput');
  const videoInputs = devices.filter((device) => device.kind === 'videoinput');
  const audioOutputs = devices.filter((device) => device.kind === 'audiooutput');
  return {
    audioInputs,
    videoInputs,
    audioOutputs
  };
}

export function DeviceSelector({
  preferredDevices,
  onChangePreferredDevices
}: DeviceSelectorProps): React.JSX.Element {
  const [devices, setDevices] = useState<DeviceGroups>({
    audioInputs: [],
    videoInputs: [],
    audioOutputs: []
  });
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [micLevel, setMicLevel] = useState<number>(0);
  const [micLevelStatus, setMicLevelStatus] = useState<MicLevelStatus>('low');
  const [testToneNotice, setTestToneNotice] = useState<string | null>(null);
  const [permissionNotice, setPermissionNotice] = useState<string | null>(null);
  const [cameraPermission, setCameraPermission] = useState<PermissionStateView>('unknown');
  const [microphonePermission, setMicrophonePermission] = useState<PermissionStateView>('unknown');
  const [previewReloadToken, setPreviewReloadToken] = useState<number>(0);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const toneAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const toneContextRef = useRef<AudioContext | null>(null);
  const toneOscillatorRef = useRef<OscillatorNode | null>(null);
  const toneTimeoutIdRef = useRef<number | null>(null);

  function stopTestTone(): void {
    if (toneTimeoutIdRef.current !== null) {
      window.clearTimeout(toneTimeoutIdRef.current);
      toneTimeoutIdRef.current = null;
    }

    try {
      toneOscillatorRef.current?.stop();
    } catch {
      // Ignore if oscillator is already stopped.
    }
    toneOscillatorRef.current = null;

    const context = toneContextRef.current;
    toneContextRef.current = null;
    if (context) {
      void context.close();
    }
  }

  async function refreshPermissionState(): Promise<void> {
    const permissions = navigator.permissions;
    if (!permissions?.query) {
      setCameraPermission('unknown');
      setMicrophonePermission('unknown');
      return;
    }

    const updateFromState = (
      state: PermissionState,
      setValue: (next: PermissionStateView) => void
    ): void => {
      if (state === 'granted' || state === 'denied' || state === 'prompt') {
        setValue(state);
        return;
      }
      setValue('unknown');
    };

    try {
      const cameraStatus = await permissions.query({ name: 'camera' as PermissionName });
      updateFromState(cameraStatus.state, setCameraPermission);
    } catch {
      setCameraPermission('unknown');
    }

    try {
      const microphoneStatus = await permissions.query({ name: 'microphone' as PermissionName });
      updateFromState(microphoneStatus.state, setMicrophonePermission);
    } catch {
      setMicrophonePermission('unknown');
    }
  }

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.enumerateDevices) {
      return;
    }

    const loadDevices = async (): Promise<void> => {
      try {
        const enumerated = await mediaDevices.enumerateDevices();
        setDevices(groupDevices(enumerated));
      } catch {
        setPreviewError('Cannot enumerate media devices.');
      }
    };

    void loadDevices();
    mediaDevices.addEventListener?.('devicechange', loadDevices);
    return () => {
      mediaDevices.removeEventListener?.('devicechange', loadDevices);
    };
  }, []);

  useEffect(() => {
    const permissions = navigator.permissions;
    if (!permissions?.query) {
      setCameraPermission('unknown');
      setMicrophonePermission('unknown');
      return;
    }

    let disposed = false;
    let cameraStatus: PermissionStatus | null = null;
    let microphoneStatus: PermissionStatus | null = null;

    const run = async (): Promise<void> => {
      try {
        cameraStatus = await permissions.query({ name: 'camera' as PermissionName });
        if (!disposed) {
          setCameraPermission(cameraStatus.state as PermissionStateView);
          cameraStatus.onchange = () => {
            setCameraPermission((cameraStatus?.state ?? 'prompt') as PermissionStateView);
          };
        }
      } catch {
        if (!disposed) {
          setCameraPermission('unknown');
        }
      }

      try {
        microphoneStatus = await permissions.query({ name: 'microphone' as PermissionName });
        if (!disposed) {
          setMicrophonePermission(microphoneStatus.state as PermissionStateView);
          microphoneStatus.onchange = () => {
            setMicrophonePermission((microphoneStatus?.state ?? 'prompt') as PermissionStateView);
          };
        }
      } catch {
        if (!disposed) {
          setMicrophonePermission('unknown');
        }
      }
    };

    void run();
    return () => {
      disposed = true;
      if (cameraStatus) {
        cameraStatus.onchange = null;
      }
      if (microphoneStatus) {
        microphoneStatus.onchange = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      return;
    }

    const applyPreview = async (): Promise<void> => {
      try {
        setPreviewError(null);
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: preferredDevices.audioInputId
            ? {
                deviceId: {
                  exact: preferredDevices.audioInputId
                }
              }
            : true,
          video: preferredDevices.videoInputId
            ? {
                deviceId: {
                  exact: preferredDevices.videoInputId
                }
              }
            : true
        });

        for (const track of previewStreamRef.current?.getTracks() ?? []) {
          track.stop();
        }
        previewStreamRef.current = stream;
        setPreviewStream(stream);

        const previewVideo = previewVideoRef.current;
        if (previewVideo) {
          previewVideo.srcObject = stream;
          try {
            const playResult = previewVideo.play();
            void playResult?.catch(() => undefined);
          } catch {
            // Ignore preview autoplay failures in restricted environments.
          }
        }
      } catch (error) {
        setPreviewError(error instanceof Error ? error.message : 'Cannot start media preview.');
      }
    };

    void applyPreview();
    return () => {
      for (const track of previewStreamRef.current?.getTracks() ?? []) {
        track.stop();
      }
      previewStreamRef.current = null;
      setPreviewStream(null);
      setMicLevel(0);
    };
  }, [preferredDevices.audioInputId, preferredDevices.videoInputId, previewReloadToken]);

  useEffect(() => {
    const audioTrack = previewStream?.getAudioTracks?.()[0];
    if (!previewStream || !audioTrack) {
      setMicLevel(0);
      setMicLevelStatus('low');
      return;
    }

    const AudioContextCtor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      setMicLevel(0);
      setMicLevelStatus('low');
      return;
    }

    const audioContext = new AudioContextCtor();
    const source = audioContext.createMediaStreamSource(previewStream);
    const analyzer = audioContext.createAnalyser();
    analyzer.fftSize = 256;
    source.connect(analyzer);
    const buffer = new Uint8Array(analyzer.fftSize);
    let frameId = 0;

    const tick = (): void => {
      analyzer.getByteTimeDomainData(buffer);
      let sumSquares = 0;
      for (const sample of buffer) {
        const normalized = (sample - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / Math.max(1, buffer.length));
      const level = Math.min(100, Math.round(rms * 280));
      setMicLevel(level);
      setMicLevelStatus(level < 20 ? 'low' : level > 80 ? 'high' : 'good');
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
      try {
        source.disconnect();
        analyzer.disconnect();
      } catch {
        // Ignore teardown issues in browsers with partial WebAudio support.
      }
      void audioContext.close();
    };
  }, [previewStream]);

  useEffect(() => {
    return () => {
      stopTestTone();
    };
  }, []);

  const micStatusText =
    micLevelStatus === 'low'
      ? 'Input too low. Move closer to microphone or increase gain.'
      : micLevelStatus === 'high'
        ? 'Input is too hot. Reduce microphone gain to avoid clipping.'
        : 'Microphone level looks good.';

  if (!navigator.mediaDevices?.enumerateDevices) {
    return (
      <section>
        <h2>Devices</h2>
        <p>Media device API is unavailable in this browser.</p>
      </section>
    );
  }

  return (
    <section>
      <h2>Devices</h2>
      <div style={{ marginBottom: '10px' }}>
        <p>Camera permission: {cameraPermission}</p>
        <p>Microphone permission: {microphonePermission}</p>
        {cameraPermission === 'denied' || microphonePermission === 'denied' ? (
          <AlertNotice label="Device permissions blocked">
            Camera or microphone is blocked. Allow access in browser site settings, then refresh.
          </AlertNotice>
        ) : null}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
        <label>
          Camera
          <select
            value={preferredDevices.videoInputId}
            onChange={(event) => {
              onChangePreferredDevices({ videoInputId: event.target.value });
            }}
          >
            <option value="">Default camera</option>
            {devices.videoInputs.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Camera ${index + 1}`}
              </option>
            ))}
          </select>
        </label>

        <label>
          Microphone
          <select
            value={preferredDevices.audioInputId}
            onChange={(event) => {
              onChangePreferredDevices({ audioInputId: event.target.value });
            }}
          >
            <option value="">Default microphone</option>
            {devices.audioInputs.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${index + 1}`}
              </option>
            ))}
          </select>
        </label>

        <label>
          Speaker
          <select
            value={preferredDevices.audioOutputId}
            onChange={(event) => {
              onChangePreferredDevices({ audioOutputId: event.target.value });
            }}
          >
            <option value="">Default speaker</option>
            {devices.audioOutputs.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Speaker ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ marginTop: '10px' }}>
        <button
          type="button"
          onClick={async () => {
            try {
              const enumerated = await navigator.mediaDevices.enumerateDevices();
              setDevices(groupDevices(enumerated));
            } catch {
              setPreviewError('Cannot refresh media devices.');
            }
          }}
        >
          Refresh devices
        </button>
        <button
          type="button"
          style={{ marginLeft: '8px' }}
          onClick={async () => {
            if (!navigator.mediaDevices?.getUserMedia) {
              setPermissionNotice('Permission request is unavailable in this browser.');
              return;
            }

            try {
              const permissionStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: true
              });
              for (const track of permissionStream.getTracks()) {
                track.stop();
              }
              setPermissionNotice('Permissions granted. Preview updated.');
            } catch (error) {
              setPermissionNotice(
                error instanceof Error ? error.message : 'Permissions request failed.'
              );
            }

            await refreshPermissionState();
            setPreviewReloadToken((current) => current + 1);
          }}
        >
          Request permissions
        </button>
        <button
          type="button"
          style={{ marginLeft: '8px' }}
          onClick={async () => {
            const AudioContextCtor =
              window.AudioContext ??
              (window as typeof window & { webkitAudioContext?: typeof AudioContext })
                .webkitAudioContext;
            if (!AudioContextCtor) {
              setTestToneNotice('Test tone is not supported in this browser.');
              return;
            }

            const audioElement = toneAudioRef.current as (HTMLAudioElement & {
              setSinkId?: (sinkId: string) => Promise<void>;
            }) | null;
            if (!audioElement) {
              setTestToneNotice('Audio output element is unavailable.');
              return;
            }

            stopTestTone();

            try {
              const context = new AudioContextCtor();
              const destination = context.createMediaStreamDestination();
              const oscillator = context.createOscillator();
              const gainNode = context.createGain();

              oscillator.type = 'sine';
              oscillator.frequency.value = 660;
              gainNode.gain.value = 0.0001;
              gainNode.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.03);
              gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.9);

              oscillator.connect(gainNode);
              gainNode.connect(destination);

              audioElement.srcObject = destination.stream;
              if (
                preferredDevices.audioOutputId &&
                typeof audioElement.setSinkId === 'function'
              ) {
                await audioElement.setSinkId(preferredDevices.audioOutputId);
              }
              await audioElement.play();

              oscillator.start();
              oscillator.stop(context.currentTime + 0.95);
              toneContextRef.current = context;
              toneOscillatorRef.current = oscillator;
              setTestToneNotice('Playing test tone.');

              toneTimeoutIdRef.current = window.setTimeout(() => {
                stopTestTone();
                setTestToneNotice('Test tone finished.');
              }, 1000);
            } catch (error) {
              stopTestTone();
              setTestToneNotice(
                error instanceof Error ? error.message : 'Failed to play test tone.'
              );
            }
          }}
        >
          Play test tone
        </button>
      </div>

      <div style={{ marginTop: '10px' }}>
        <p>Preview</p>
        <video
          ref={previewVideoRef}
          autoPlay
          muted
          playsInline
          style={{ width: '320px', maxWidth: '100%', borderRadius: '10px', border: '1px solid #d4d4d8' }}
        />
        <audio ref={toneAudioRef} />
      </div>

      <div style={{ marginTop: '10px' }}>
        <p>Mic level</p>
        <div
          role="progressbar"
          aria-label="Mic level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={micLevel}
          style={{
            height: '10px',
            maxWidth: '320px',
            width: '100%',
            borderRadius: '999px',
            background: '#e2e8f0',
            overflow: 'hidden',
            border: '1px solid #cbd5e1'
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${micLevel}%`,
              background: micLevel > 70 ? '#dc2626' : micLevel > 35 ? '#f59e0b' : '#16a34a',
              transition: 'width 120ms linear'
            }}
          />
        </div>
        <p>{micLevel}%</p>
        <StatusNotice label="Microphone level status">{micStatusText}</StatusNotice>
        {permissionNotice ? (
          <StatusNotice label="Permission request status">{permissionNotice}</StatusNotice>
        ) : null}
        {testToneNotice ? <StatusNotice label="Test tone status">{testToneNotice}</StatusNotice> : null}
      </div>

      {previewError ? <AlertNotice label="Device preview error">{previewError}</AlertNotice> : null}
    </section>
  );
}
