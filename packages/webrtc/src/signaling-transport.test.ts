// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalingTransport } from './signaling-transport.js';

const MAX_SIGNALING_MESSAGE_BYTES = 8 * 1024;

type Listener = (event?: unknown) => void;

class FakeWebSocket {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;
  public static readonly instances: FakeWebSocket[] = [];

  public readonly url: string;
  public readyState = FakeWebSocket.CONNECTING;
  public sent: string[] = [];

  private readonly listeners = new Map<string, Listener[]>();

  public constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  public addEventListener(type: string, listener: Listener): void {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  public send(payload: string): void {
    this.sent.push(payload);
  }

  public close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close');
  }

  public emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open');
  }

  public emitClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close');
  }

  public emitMessage(data: unknown): void {
    this.emit('message', { data });
  }

  private emit(type: string, event?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function getLastSocket(): FakeWebSocket {
  const last = FakeWebSocket.instances.at(-1);
  if (!last) {
    throw new Error('Expected at least one websocket instance.');
  }

  return last;
}

describe('SignalingTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    sessionStorage.clear();
    FakeWebSocket.instances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    FakeWebSocket.instances.length = 0;
  });

  it('sends join payload on socket open', async () => {
    const getToken = vi.fn(async () => 'token-abc');
    const transport = new SignalingTransport({
      url: 'ws://localhost:3001/ws',
      peerId: '11111111-1111-4111-8111-111111111111',
      peerPublicKey: 'peer-public-key',
      getToken
    });

    transport.connect('room-join');

    const socket = getLastSocket();
    socket.emitOpen();
    await Promise.resolve();

    expect(getToken).toHaveBeenCalledTimes(1);
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0] as string)).toEqual({
      type: 'join',
      roomId: 'room-join',
      peerId: '11111111-1111-4111-8111-111111111111',
      token: 'token-abc',
      peerPublicKey: 'peer-public-key'
    });
  });

  it('reconnects from stored room id and sends join', async () => {
    sessionStorage.setItem('p2p.roomId', 'room-restored');
    const getToken = vi.fn(async () => 'token-restored');
    const transport = new SignalingTransport({
      url: 'ws://localhost:3001/ws',
      peerId: '12121212-1212-4121-8121-121212121212',
      peerPublicKey: 'peer-public-key',
      getToken
    });

    const didReconnect = transport.reconnectFromSession();
    expect(didReconnect).toBe(true);

    const socket = getLastSocket();
    socket.emitOpen();
    await Promise.resolve();

    expect(getToken).toHaveBeenCalledTimes(1);
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0] as string)).toMatchObject({
      type: 'join',
      roomId: 'room-restored',
      peerId: '12121212-1212-4121-8121-121212121212'
    });
  });

  it('exhausts reconnect attempts after exponential backoff', () => {
    const onStatus = vi.fn();
    const onError = vi.fn();
    const transport = new SignalingTransport({
      url: 'ws://localhost:3001/ws',
      peerId: '22222222-2222-4222-8222-222222222222',
      peerPublicKey: 'peer-public-key',
      getToken: async () => 'token',
      onStatus,
      onError
    });

    transport.connect('room-reconnect');

    const delays = [1000, 2000, 4000, 8000, 16000];
    for (const delay of delays) {
      getLastSocket().emitClose();
      vi.advanceTimersByTime(delay);
    }

    // One extra close should hit exhaustion.
    getLastSocket().emitClose();

    const errorMessages = onError.mock.calls.map(([error]) =>
      error instanceof Error ? error.message : String(error)
    );
    expect(errorMessages).toContain('Reconnect attempts exhausted.');
    expect(onStatus).toHaveBeenCalledWith('closed');
  });

  it('resets reconnect counter on manual connect after exhaustion', () => {
    const onError = vi.fn();
    const transport = new SignalingTransport({
      url: 'ws://localhost:3001/ws',
      peerId: '33333333-3333-4333-8333-333333333333',
      peerPublicKey: 'peer-public-key',
      getToken: async () => 'token',
      onError
    });

    transport.connect('room-a');

    const delays = [1000, 2000, 4000, 8000, 16000];
    for (const delay of delays) {
      getLastSocket().emitClose();
      vi.advanceTimersByTime(delay);
    }
    getLastSocket().emitClose();
    const errorMessages = onError.mock.calls.map(([error]) =>
      error instanceof Error ? error.message : String(error)
    );
    expect(errorMessages).toContain('Reconnect attempts exhausted.');

    transport.connect('room-a');
    const socketsAfterManualReconnect = FakeWebSocket.instances.length;

    getLastSocket().emitClose();
    vi.advanceTimersByTime(1000);

    expect(FakeWebSocket.instances.length).toBe(socketsAfterManualReconnect + 1);
  });

  it('ignores close events from stale sockets after reconnect', () => {
    const onStatus = vi.fn();
    const transport = new SignalingTransport({
      url: 'ws://localhost:3001/ws',
      peerId: '44444444-4444-4444-8444-444444444444',
      peerPublicKey: 'peer-public-key',
      getToken: async () => 'token',
      onStatus
    });

    transport.connect('room-a');
    const first = getLastSocket();

    transport.connect('room-a');
    const second = getLastSocket();
    expect(second).not.toBe(first);

    // If stale close is not ignored, reconnect timer would create another socket.
    first.emitClose();
    vi.advanceTimersByTime(20_000);

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(onStatus).not.toHaveBeenCalledWith('reconnecting');
  });

  it('rejects oversized signaling payload before JSON parsing', () => {
    const onError = vi.fn();
    const onMessage = vi.fn();
    const transport = new SignalingTransport({
      url: 'ws://localhost:3001/ws',
      peerId: '55555555-5555-4555-8555-555555555555',
      peerPublicKey: 'peer-public-key',
      getToken: async () => 'token',
      onError,
      onMessage
    });

    transport.connect('room-oversized');
    const socket = getLastSocket();
    socket.emitOpen();
    socket.emitMessage(
      JSON.stringify({
        type: 'error',
        code: 'oversized-test',
        message: 'x'.repeat(MAX_SIGNALING_MESSAGE_BYTES + 256)
      })
    );

    expect(onMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });

  it('clears stored room id on leave', () => {
    const transport = new SignalingTransport({
      url: 'ws://localhost:3001/ws',
      peerId: '56565656-5656-4565-8565-565656565656',
      peerPublicKey: 'peer-public-key',
      getToken: async () => 'token'
    });

    transport.connect('room-leave');
    expect(sessionStorage.getItem('p2p.roomId')).toBe('room-leave');

    transport.leave();
    expect(sessionStorage.getItem('p2p.roomId')).toBeNull();
  });

  it('refuses to send oversized outbound relay message', async () => {
    const onError = vi.fn();
    const transport = new SignalingTransport({
      url: 'ws://localhost:3001/ws',
      peerId: '67676767-6767-4676-8676-676767676767',
      peerPublicKey: 'peer-public-key',
      getToken: async () => 'token',
      onError
    });

    transport.connect('room-outbound-size');
    const socket = getLastSocket();
    socket.emitOpen();
    await Promise.resolve();

    transport.send({
      type: 'offer',
      to: '78787878-7878-4787-8787-787878787878',
      sdp: {
        type: 'offer',
        sdp: 'x'.repeat(MAX_SIGNALING_MESSAGE_BYTES + 256)
      }
    });

    expect(socket.sent).toHaveLength(1); // join only
    const errorMessages = onError.mock.calls.map(([error]) =>
      error instanceof Error ? error.message : String(error)
    );
    expect(
      errorMessages.some((message) =>
        message.includes(
          `Refusing to send signaling payload larger than ${MAX_SIGNALING_MESSAGE_BYTES} bytes.`
        )
      )
    ).toBe(true);
  });

  it('refuses oversized join payload and reports send error', async () => {
    const onError = vi.fn();
    const getToken = vi.fn(async () => 'token');
    const transport = new SignalingTransport({
      url: 'ws://localhost:3001/ws',
      peerId: '79797979-7979-4797-8797-797979797979',
      peerPublicKey: 'k'.repeat(MAX_SIGNALING_MESSAGE_BYTES + 256),
      getToken,
      onError
    });

    transport.connect('room-join-too-large');
    const socket = getLastSocket();
    socket.emitOpen();
    await Promise.resolve();

    expect(getToken).toHaveBeenCalledTimes(1);
    expect(socket.sent).toHaveLength(0);
    const errorMessages = onError.mock.calls.map(([error]) =>
      error instanceof Error ? error.message : String(error)
    );
    expect(
      errorMessages.some((message) =>
        message.includes(
          `Refusing to send signaling payload larger than ${MAX_SIGNALING_MESSAGE_BYTES} bytes.`
        )
      )
    ).toBe(true);
  });
});
