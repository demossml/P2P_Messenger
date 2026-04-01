// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalingTransport } from './signaling-transport.js';

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
});
