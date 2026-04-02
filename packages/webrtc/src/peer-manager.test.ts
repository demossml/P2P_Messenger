import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PeerManager } from './peer-manager.js';

const MAX_CHAT_MESSAGE_BYTES = 256 * 1024;

type SentMessage = {
  type: 'offer' | 'answer' | 'ice-candidate';
  to: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

class FakeDataChannel {
  public readonly label: string;
  public readonly protocol: string;
  public readyState: RTCDataChannelState = 'open';
  public bufferedAmount = 0;
  public bufferedAmountLowThreshold = 0;
  public onmessage: ((event: MessageEvent<string>) => void) | null = null;
  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public sentPayloads: string[] = [];
  private readonly listeners = new Map<string, Array<() => void>>();

  public constructor(label: string, protocol: string) {
    this.label = label;
    this.protocol = protocol;
  }

  public addEventListener(
    type: string,
    listener: () => void,
    options?: AddEventListenerOptions | boolean
  ): void {
    const current = this.listeners.get(type) ?? [];
    if (options && typeof options === 'object' && options.once) {
      const onceListener = () => {
        this.removeEventListener(type, onceListener);
        listener();
      };
      current.push(onceListener);
      this.listeners.set(type, current);
      return;
    }

    current.push(listener);
    this.listeners.set(type, current);
  }

  public removeEventListener(type: string, listener: () => void): void {
    const current = this.listeners.get(type);
    if (!current) {
      return;
    }

    const next = current.filter((candidate) => candidate !== listener);
    if (next.length === 0) {
      this.listeners.delete(type);
      return;
    }
    this.listeners.set(type, next);
  }

  public send(payload: string): void {
    this.sentPayloads.push(payload);
  }

  public emit(type: string): void {
    const current = this.listeners.get(type) ?? [];
    for (const listener of current) {
      listener();
    }
  }

  public close(): void {
    this.readyState = 'closed';
  }
}

class FakeMediaStream {
  private readonly tracks: MediaStreamTrack[] = [];

  public constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  public getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }

  public addTrack(track: MediaStreamTrack): void {
    this.tracks.push(track);
  }

  public removeTrack(track: MediaStreamTrack): void {
    const index = this.tracks.findIndex((item) => item.id === track.id);
    if (index >= 0) {
      this.tracks.splice(index, 1);
    }
  }
}

class FakeRTCPeerConnection {
  public static readonly instances: FakeRTCPeerConnection[] = [];

  public onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  public ontrack: ((event: { track: MediaStreamTrack; streams: MediaStream[] }) => void) | null =
    null;
  public onconnectionstatechange: (() => void) | null = null;
  public ondatachannel: ((event: { channel: RTCDataChannel }) => void) | null = null;

  public localDescription: RTCSessionDescriptionInit | null = null;
  public remoteDescription: RTCSessionDescriptionInit | null = null;
  public connectionState: RTCPeerConnectionState = 'new';
  public addedCandidates: RTCIceCandidateInit[] = [];
  public restartCount = 0;
  public lastConfiguration: RTCConfiguration | null = null;
  public lastDataChannel: FakeDataChannel | null = null;
  private readonly senders: Array<{
    track: MediaStreamTrack | null;
    replaceTrack: (track: MediaStreamTrack | null) => Promise<void>;
  }> = [];

  public constructor(public readonly configuration: RTCConfiguration) {
    this.lastConfiguration = configuration;
    FakeRTCPeerConnection.instances.push(this);
  }

  public createDataChannel(label: string, options?: RTCDataChannelInit): RTCDataChannel {
    const channel = new FakeDataChannel(label, options?.protocol ?? '');
    this.lastDataChannel = channel;
    return channel as unknown as RTCDataChannel;
  }

  public addTrack(track: MediaStreamTrack): RTCRtpSender {
    const sender = {
      track,
      replaceTrack: vi.fn(async () => undefined)
    };
    this.senders.push(sender);
    return sender as unknown as RTCRtpSender;
  }

  public getSenders(): RTCRtpSender[] {
    return this.senders as unknown as RTCRtpSender[];
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'fake-offer-sdp' };
  }

  public async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'fake-answer-sdp' };
  }

  public async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description;
  }

  public async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description;
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.addedCandidates.push(candidate);
  }

  public setConfiguration(configuration: RTCConfiguration): void {
    this.lastConfiguration = configuration;
  }

  public restartIce(): void {
    this.restartCount += 1;
  }

  public close(): void {
    this.connectionState = 'closed';
  }
}

describe('PeerManager', () => {
  beforeEach(() => {
    FakeRTCPeerConnection.instances.length = 0;
    vi.stubGlobal(
      'RTCPeerConnection',
      FakeRTCPeerConnection as unknown as typeof RTCPeerConnection
    );
    vi.stubGlobal('MediaStream', FakeMediaStream as unknown as typeof MediaStream);
    vi.stubGlobal('window', globalThis);
  });

  it('creates offer and chat channel when local peer is initiator', async () => {
    const sentMessages: SentMessage[] = [];
    const manager = new PeerManager({
      localPeerId: 'peer-z',
      transport: {
        send: (message: SentMessage) => {
          sentMessages.push(message);
        }
      } as never
    });

    await manager.handleSignalingMessage({
      type: 'peer-joined',
      peerId: 'peer-a',
      peerPublicKey: 'pub'
    });

    expect(manager.hasOpenChatChannel('peer-a')).toBe(true);
    expect(sentMessages).toEqual([
      {
        type: 'offer',
        to: 'peer-a',
        sdp: { type: 'offer', sdp: 'fake-offer-sdp' }
      }
    ]);
  });

  it('queues remote ice candidates until remote description is set by offer', async () => {
    const sentMessages: SentMessage[] = [];
    const manager = new PeerManager({
      localPeerId: 'peer-a',
      transport: {
        send: (message: SentMessage) => {
          sentMessages.push(message);
        }
      } as never
    });

    await manager.handleSignalingMessage({
      type: 'ice-candidate',
      from: 'peer-b',
      candidate: {
        candidate: 'candidate:1',
        sdpMid: '0',
        sdpMLineIndex: 0
      }
    });

    const connectionBeforeOffer = manager.getConnections()[0]
      ?.connection as unknown as FakeRTCPeerConnection;
    expect(connectionBeforeOffer.addedCandidates).toHaveLength(0);

    await manager.handleSignalingMessage({
      type: 'offer',
      from: 'peer-b',
      sdp: { type: 'offer', sdp: 'remote-offer' }
    });

    const connection = manager.getConnections()[0]?.connection as unknown as FakeRTCPeerConnection;
    expect(connection.addedCandidates).toEqual([
      {
        candidate: 'candidate:1',
        sdpMid: '0',
        sdpMLineIndex: 0
      }
    ]);
    expect(sentMessages).toContainEqual({
      type: 'answer',
      to: 'peer-b',
      sdp: { type: 'answer', sdp: 'fake-answer-sdp' }
    });
  });

  it('enables relay mode by applying relay configuration and restarting ice', async () => {
    const sentMessages: SentMessage[] = [];
    const manager = new PeerManager({
      localPeerId: 'peer-z',
      transport: {
        send: (message: SentMessage) => {
          sentMessages.push(message);
        }
      } as never,
      rtcConfiguration: {
        iceServers: [{ urls: 'stun:stun.example.com:3478' }],
        iceTransportPolicy: 'all'
      }
    });

    await manager.handleSignalingMessage({
      type: 'peer-joined',
      peerId: 'peer-a',
      peerPublicKey: 'pub'
    });

    sentMessages.length = 0;

    await manager.setRelayMode(true);

    const connection = manager.getConnections()[0]?.connection as unknown as FakeRTCPeerConnection;
    expect(connection.lastConfiguration?.iceTransportPolicy).toBe('relay');
    expect(connection.restartCount).toBeGreaterThan(0);
    expect(sentMessages).toContainEqual({
      type: 'offer',
      to: 'peer-a',
      sdp: { type: 'offer', sdp: 'fake-offer-sdp' }
    });
  });

  it('rejects oversized chat payload before JSON parsing', async () => {
    const onError = vi.fn();
    const onChatMessage = vi.fn();
    const manager = new PeerManager({
      localPeerId: 'peer-a',
      transport: {
        send: () => undefined
      } as never,
      onError,
      onChatMessage
    });

    await manager.handleSignalingMessage({
      type: 'offer',
      from: 'peer-b',
      sdp: { type: 'offer', sdp: 'remote-offer' }
    });

    const connection = manager.getConnections()[0]?.connection as unknown as FakeRTCPeerConnection;
    const channel = new FakeDataChannel('chat', 'v1');
    connection.ondatachannel?.({ channel: channel as unknown as RTCDataChannel });
    const missingChunks = Array.from({ length: 70_000 }, (_, index) => index);
    const oversizedButValidMessage = JSON.stringify({
      id: '12345678-1234-4123-8123-123456789012',
      timestamp: Date.now(),
      senderId: '87654321-4321-4876-8876-210987654321',
      signature: 'sig',
      payload: {
        type: 'file-ack',
        fileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'accepted',
        missingChunks
      }
    });

    channel.onmessage?.({
      data: oversizedButValidMessage
    } as MessageEvent<string>);

    expect(onChatMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
    expect(oversizedButValidMessage.length).toBeGreaterThan(MAX_CHAT_MESSAGE_BYTES);
  });

  it('waits for bufferedamountlow before sending chat message when channel is saturated', async () => {
    const manager = new PeerManager({
      localPeerId: 'peer-z',
      transport: {
        send: () => undefined
      } as never
    });

    await manager.handleSignalingMessage({
      type: 'peer-joined',
      peerId: 'peer-a',
      peerPublicKey: 'pub'
    });

    const connection = manager.getConnections()[0]?.connection as unknown as FakeRTCPeerConnection;
    const channel = connection.lastDataChannel;
    if (!channel) {
      throw new Error('Expected initiator chat channel.');
    }

    channel.bufferedAmount = 1024 * 1024 + 10;

    const sendPromise = manager.sendChatMessage('peer-a', {
      id: '9d5537c5-4958-41f3-928d-90a41d93334b',
      timestamp: Date.now(),
      senderId: '11111111-1111-4111-8111-111111111111',
      signature: 'sig',
      payload: {
        type: 'text',
        text: 'hello with backpressure'
      }
    });

    await Promise.resolve();
    expect(channel.sentPayloads).toHaveLength(0);

    channel.bufferedAmount = 0;
    channel.emit('bufferedamountlow');

    await sendPromise;
    expect(channel.sentPayloads).toHaveLength(1);
  });

  it('reports timeout when bufferedamountlow does not arrive in time', async () => {
    vi.useFakeTimers();
    try {
      const onError = vi.fn();
      const manager = new PeerManager({
        localPeerId: 'peer-z',
        transport: {
          send: () => undefined
        } as never,
        onError
      });

      await manager.handleSignalingMessage({
        type: 'peer-joined',
        peerId: 'peer-a',
        peerPublicKey: 'pub'
      });

      const connection = manager.getConnections()[0]
        ?.connection as unknown as FakeRTCPeerConnection;
      const channel = connection.lastDataChannel;
      if (!channel) {
        throw new Error('Expected initiator chat channel.');
      }

      channel.bufferedAmount = 1024 * 1024 + 10;

      const sendPromise = manager.sendChatMessage('peer-a', {
        id: 'ef50f0a4-152a-4cb4-b914-9f98b8df1f7e',
        timestamp: Date.now(),
        senderId: '22222222-2222-4222-8222-222222222222',
        signature: 'sig',
        payload: {
          type: 'text',
          text: 'timeout path'
        }
      });

      await vi.advanceTimersByTimeAsync(5000);
      await sendPromise;

      expect(channel.sentPayloads).toHaveLength(0);
      const errorMessages = onError.mock.calls.map(([error]) =>
        error instanceof Error ? error.message : String(error)
      );
      expect(
        errorMessages.some((message) =>
          message.includes('Timed out waiting for DataChannel buffer to drain.')
        )
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects oversized outbound chat payload before sending to data channel', async () => {
    const onError = vi.fn();
    const manager = new PeerManager({
      localPeerId: 'peer-z',
      transport: {
        send: () => undefined
      } as never,
      onError
    });

    await manager.handleSignalingMessage({
      type: 'peer-joined',
      peerId: 'peer-a',
      peerPublicKey: 'pub'
    });

    const connection = manager.getConnections()[0]?.connection as unknown as FakeRTCPeerConnection;
    const channel = connection.lastDataChannel;
    if (!channel) {
      throw new Error('Expected initiator chat channel.');
    }

    const oversizedMessage = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      timestamp: Date.now(),
      senderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      signature: 'sig',
      payload: {
        type: 'file-ack' as const,
        fileId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        status: 'accepted' as const,
        missingChunks: Array.from({ length: 70_000 }, (_, index) => index)
      }
    };

    await manager.sendChatMessage('peer-a', oversizedMessage);

    expect(channel.sentPayloads).toHaveLength(0);
    const errorMessages = onError.mock.calls.map(([error]) =>
      error instanceof Error ? error.message : String(error)
    );
    expect(
      errorMessages.some((message) =>
        message.includes(`Outgoing chat message exceeds ${MAX_CHAT_MESSAGE_BYTES} bytes.`)
      )
    ).toBe(true);
  });
});
