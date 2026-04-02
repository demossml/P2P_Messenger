import {
  type SignalingInboundMessage,
  type SignalingOutboundMessage,
  signalingOutboundSchema
} from '@p2p/shared';

const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000] as const;
const MAX_SIGNALING_MESSAGE_BYTES = 8 * 1024;

function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).byteLength;
  }

  return value.length;
}

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

type RelayMessage = Extract<
  SignalingInboundMessage,
  { type: 'offer' | 'answer' | 'ice-candidate' }
>;
type LeaveMessage = Extract<SignalingInboundMessage, { type: 'leave' }>;

export type SignalingTransportOptions = {
  url: string;
  peerId: string;
  peerPublicKey: string;
  getToken: () => Promise<string>;
  roomStorageKey?: string;
  onStatus?: (status: ConnectionStatus) => void;
  onMessage?: (message: SignalingOutboundMessage) => void;
  onError?: (error: Error) => void;
};

export class SignalingTransport {
  private readonly roomStorageKey: string;
  private readonly onStatus: (status: ConnectionStatus) => void;
  private readonly onMessage: (message: SignalingOutboundMessage) => void;
  private readonly onError: (error: Error) => void;

  private socket: WebSocket | null = null;
  private reconnectTimeoutId: number | null = null;
  private reconnectAttempt = 0;
  private activeRoomId: string | null = null;
  private manualClose = false;

  public constructor(private readonly options: SignalingTransportOptions) {
    this.roomStorageKey = options.roomStorageKey ?? 'p2p.roomId';
    this.onStatus = options.onStatus ?? (() => undefined);
    this.onMessage = options.onMessage ?? (() => undefined);
    this.onError = options.onError ?? (() => undefined);
  }

  public connect(roomId: string): void {
    this.activeRoomId = roomId;
    this.persistRoomId(roomId);
    this.manualClose = false;
    this.reconnectAttempt = 0;
    this.openSocket('connecting');
  }

  public reconnectFromSession(): boolean {
    const roomId = this.readStoredRoomId();
    if (!roomId) {
      return false;
    }

    this.connect(roomId);
    return true;
  }

  public send(message: RelayMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.onError(new Error('Cannot send signaling message while socket is not open.'));
      return;
    }

    this.sendJson(message);
  }

  public leave(): void {
    if (!this.activeRoomId) {
      return;
    }

    const leaveMessage: LeaveMessage = {
      type: 'leave',
      roomId: this.activeRoomId
    };

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.sendJson(leaveMessage);
    }

    this.clearStoredRoomId();
    this.activeRoomId = null;
  }

  public disconnect(): void {
    this.manualClose = true;
    this.clearReconnectTimer();
    this.onStatus('closed');
    this.leave();

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  private openSocket(status: ConnectionStatus): void {
    this.clearReconnectTimer();
    this.onStatus(status);

    const previousSocket = this.socket;
    const socket = new WebSocket(this.options.url);
    this.socket = socket;
    if (previousSocket) {
      previousSocket.close();
    }

    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return;
      }

      this.reconnectAttempt = 0;
      this.onStatus('connected');
      void this.sendJoin();
    });

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) {
        return;
      }

      this.handleMessage(event.data);
    });

    socket.addEventListener('error', () => {
      if (this.socket !== socket) {
        return;
      }

      this.onError(new Error('WebSocket signaling error.'));
    });

    socket.addEventListener('close', () => {
      if (this.socket !== socket) {
        return;
      }

      if (this.manualClose || !this.activeRoomId) {
        this.onStatus('closed');
        return;
      }

      this.scheduleReconnect();
    });
  }

  private async sendJoin(): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.activeRoomId) {
      return;
    }

    try {
      const token = await this.options.getToken();
      const joinMessage: Extract<SignalingInboundMessage, { type: 'join' }> = {
        type: 'join',
        roomId: this.activeRoomId,
        peerId: this.options.peerId,
        token,
        peerPublicKey: this.options.peerPublicKey
      };

      this.sendJson(joinMessage);
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error('Failed to fetch signaling token.'));
    }
  }

  private scheduleReconnect(): void {
    if (!this.activeRoomId) {
      return;
    }

    if (this.reconnectAttempt >= RECONNECT_BACKOFF_MS.length) {
      this.onStatus('closed');
      this.onError(new Error('Reconnect attempts exhausted.'));
      return;
    }

    const delay = RECONNECT_BACKOFF_MS[this.reconnectAttempt];
    this.reconnectAttempt += 1;
    this.onStatus('reconnecting');

    this.reconnectTimeoutId = window.setTimeout(() => {
      this.openSocket('reconnecting');
    }, delay);
  }

  private handleMessage(rawData: unknown): void {
    if (typeof rawData !== 'string') {
      this.onError(new Error('Received non-text signaling payload.'));
      return;
    }

    const messageSize = utf8ByteLength(rawData);
    if (messageSize > MAX_SIGNALING_MESSAGE_BYTES) {
      this.onError(
        new Error(`Received signaling payload larger than ${MAX_SIGNALING_MESSAGE_BYTES} bytes.`)
      );
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      this.onError(new Error('Received malformed JSON from signaling server.'));
      return;
    }

    const validated = signalingOutboundSchema.safeParse(parsed);
    if (!validated.success) {
      this.onError(new Error('Received signaling message with invalid schema.'));
      return;
    }

    this.onMessage(validated.data);
  }

  private persistRoomId(roomId: string): void {
    try {
      sessionStorage.setItem(this.roomStorageKey, roomId);
    } catch {
      this.onError(new Error('Cannot write room id into sessionStorage.'));
    }
  }

  private readStoredRoomId(): string | null {
    try {
      return sessionStorage.getItem(this.roomStorageKey);
    } catch {
      return null;
    }
  }

  private clearStoredRoomId(): void {
    try {
      sessionStorage.removeItem(this.roomStorageKey);
    } catch {
      this.onError(new Error('Cannot clear room id from sessionStorage.'));
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  private sendJson(value: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.onError(new Error('Cannot send signaling message while socket is not open.'));
      return;
    }

    const serialized = JSON.stringify(value);
    const messageSize = utf8ByteLength(serialized);
    if (messageSize > MAX_SIGNALING_MESSAGE_BYTES) {
      this.onError(
        new Error(
          `Refusing to send signaling payload larger than ${MAX_SIGNALING_MESSAGE_BYTES} bytes.`
        )
      );
      return;
    }

    this.socket.send(serialized);
  }
}
