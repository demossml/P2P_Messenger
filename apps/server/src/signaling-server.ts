import { Redis } from 'ioredis';
import { App, type WebSocket } from 'uWebSockets.js';
import { v4 as uuidv4 } from 'uuid';
import {
  type SignalingInboundMessage,
  type SignalingOutboundMessage,
  signalingInboundSchema
} from '@p2p/shared';
import { env } from './env.js';
import { AuthService, AuthServiceError } from './auth-service.js';
import { verifyJwt, verifyRoomToken } from './jwt.js';
import { log } from './logger.js';
import { ConnectionRateLimiter } from './rate-limiter.js';
import { RoomManager } from './room-manager.js';
import { issueTurnCredentials } from './turn-credentials.js';
import type { ConnectionState } from './types.js';

const MAX_MESSAGE_SIZE = 8 * 1024;

type Socket = WebSocket<ConnectionState>;
type OfferOrAnswerSdp = Extract<
  SignalingInboundMessage,
  { type: 'offer' | 'answer' }
>['sdp'];
type IceCandidate = Extract<SignalingInboundMessage, { type: 'ice-candidate' }>['candidate'];

type RelayPayload =
  | {
      type: 'offer' | 'answer';
      to: string;
      from: string;
      roomId: string;
      payload: { type: 'offer' | 'answer'; sdp: OfferOrAnswerSdp };
    }
  | {
      type: 'ice-candidate';
      to: string;
      from: string;
      roomId: string;
      payload: { type: 'ice-candidate'; candidate: IceCandidate };
    };

type BroadcastPayload = {
  type: 'peer-joined' | 'peer-left';
  roomId: string;
  excludedPeerId: string;
  message: SignalingOutboundMessage;
};

type PubSubEvent =
  | { kind: 'relay'; payload: RelayPayload }
  | { kind: 'broadcast'; payload: BroadcastPayload };

export class SignalingServer {
  private readonly redis = new Redis(env.REDIS_URL);
  private readonly redisSub = new Redis(env.REDIS_URL);
  private readonly authService = new AuthService(this.redis);
  private readonly socketsByPeerId = new Map<string, Socket>();
  private readonly roomManager = new RoomManager(
    this.redis,
    env.ROOM_TTL_SECONDS,
    env.ROOM_MAX_PEERS
  );
  private readonly rateLimiter = new ConnectionRateLimiter(this.redis, env.WS_RATE_LIMIT_PER_SECOND);

  public start(): void {
    this.initializePubSub();

    App()
      .options('/*', (response, request) => {
        const origin = request.getHeader('origin');
        if (origin !== env.ALLOWED_ORIGIN) {
          response.writeStatus('403 Forbidden').end('Origin is not allowed.');
          return;
        }

        this.applyCorsHeaders(response);
        response.writeStatus('204 No Content').end('');
      })
      .get('/health', (response) => {
        response.writeStatus('200 OK').end('ok');
      })
      .get('/auth/dev-login', (response, request) => {
        if (env.NODE_ENV === 'production') {
          response.writeStatus('404 Not Found').end('Not found.');
          return;
        }

        let aborted = false;
        response.onAborted(() => {
          aborted = true;
        });

        void (async () => {
          const query = new URLSearchParams(request.getQuery());
          const userId = query.get('userId')?.trim() || 'demo-user';

          try {
            const session = await this.authService.issueSession(userId);
            if (aborted) {
              return;
            }

            this.applyCorsHeaders(response);
            this.writeJson(response, 200, session);
          } catch {
            if (aborted) {
              return;
            }

            this.applyCorsHeaders(response);
            response.writeStatus('500 Internal Server Error').end('Cannot issue auth session.');
          }
        })();
      })
      .get('/auth/refresh', (response, request) => {
        let aborted = false;
        response.onAborted(() => {
          aborted = true;
        });

        void (async () => {
          const query = new URLSearchParams(request.getQuery());
          const refreshToken = query.get('token')?.trim();
          if (!refreshToken) {
            if (!aborted) {
              this.applyCorsHeaders(response);
              response.writeStatus('400 Bad Request').end('Missing refresh token.');
            }
            return;
          }

          try {
            const session = await this.authService.rotate(refreshToken);
            if (aborted) {
              return;
            }

            this.applyCorsHeaders(response);
            this.writeJson(response, 200, session);
          } catch (error) {
            if (aborted) {
              return;
            }

            if (error instanceof AuthServiceError) {
              this.applyCorsHeaders(response);
              response.writeStatus('401 Unauthorized').end(error.message);
              return;
            }

            this.applyCorsHeaders(response);
            response.writeStatus('500 Internal Server Error').end('Cannot rotate refresh token.');
          }
        })();
      })
      .get('/turn-credentials', (response, request) => {
        let aborted = false;
        response.onAborted(() => {
          aborted = true;
        });

        void (async () => {
          const bearerToken = this.extractBearerToken(request.getHeader('authorization'));
          if (!bearerToken) {
            if (!aborted) {
              this.applyCorsHeaders(response);
              response.writeStatus('401 Unauthorized').end('Missing bearer token.');
            }
            return;
          }

          try {
            const payload = await verifyJwt(bearerToken, env.JWT_PUBLIC_KEY);
            if (aborted) {
              return;
            }

            const subject =
              typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : 'anon';
            const credentials = issueTurnCredentials(subject);
            this.applyCorsHeaders(response);
            response
              .writeHeader('Content-Type', 'application/json')
              .writeStatus('200 OK')
              .end(
                JSON.stringify({
                  ttlSeconds: credentials.ttlSeconds,
                  expiresAtUnix: credentials.expiresAtUnix,
                  realm: env.TURN_REALM,
                  username: credentials.username,
                  credential: credentials.credential,
                  urls: credentials.urls
                })
              );
          } catch {
            if (!aborted) {
              this.applyCorsHeaders(response);
              response.writeStatus('401 Unauthorized').end('Invalid bearer token.');
            }
          }
        })();
      })
      .ws<ConnectionState>('/ws', {
        maxPayloadLength: MAX_MESSAGE_SIZE,
        upgrade: (response, request, context) => {
          const origin = request.getHeader('origin');
          if (origin !== env.ALLOWED_ORIGIN) {
            response.writeStatus('403 Forbidden').end('Origin is not allowed.');
            return;
          }

          response.upgrade(
            {
              connectionId: uuidv4(),
              authState: 'anonymous',
              peer: undefined,
              connectedAt: Date.now()
            },
            request.getHeader('sec-websocket-key'),
            request.getHeader('sec-websocket-protocol'),
            request.getHeader('sec-websocket-extensions'),
            context
          );
        },
        open: (socket) => {
          const { connectionId } = socket.getUserData();
          log('info', 'ws_open', { connectionId });
        },
        message: async (socket, message, isBinary) => {
          if (isBinary) {
            const connection = socket.getUserData();
            log('warn', 'message_rejected', {
              reason: 'binary_payload',
              connectionId: connection.connectionId
            });
            this.sendError(socket, 'INVALID_MESSAGE_TYPE', 'Only JSON text messages are allowed.');
            return;
          }

          const connection = socket.getUserData();
          let payloadText = '';
          try {
            // Copy WS frame payload before any await. uWS payload memory is only valid synchronously.
            payloadText = Buffer.from(message).toString('utf8');
          } catch {
            log('warn', 'message_rejected', {
              reason: 'decode_failed',
              connectionId: connection.connectionId
            });
            this.sendError(socket, 'INVALID_PAYLOAD', 'Cannot decode message payload.');
            return;
          }

          const allowed = await this.rateLimiter.allow(connection.connectionId);
          if (!allowed) {
            log('warn', 'message_rejected', {
              reason: 'rate_limited',
              connectionId: connection.connectionId
            });
            this.sendError(socket, 'RATE_LIMITED', 'Too many messages.');
            return;
          }

          let rawMessage: unknown;
          try {
            rawMessage = JSON.parse(payloadText);
          } catch {
            log('warn', 'message_rejected', {
              reason: 'invalid_json',
              connectionId: connection.connectionId
            });
            this.sendError(socket, 'INVALID_JSON', 'Message is not valid JSON.');
            return;
          }

          const parsed = signalingInboundSchema.safeParse(rawMessage);
          if (!parsed.success) {
            log('warn', 'message_rejected', {
              reason: 'schema_validation_failed',
              connectionId: connection.connectionId
            });
            this.sendError(socket, 'SCHEMA_VALIDATION_FAILED', 'Message schema is invalid.');
            return;
          }

          await this.handleMessage(socket, parsed.data);
        },
        close: async (socket) => {
          await this.handleDisconnect(socket);
        }
      })
      .listen(env.PORT, (token) => {
        if (!token) {
          log('error', 'listen_failed', { port: env.PORT });
          process.exit(1);
        }

        log('info', 'server_started', { port: env.PORT });
      });
  }

  private async handleMessage(socket: Socket, message: SignalingInboundMessage): Promise<void> {
    const connection = socket.getUserData();

    log('info', 'message_received', {
      messageType: message.type,
      peerId: connection.peer?.peerId ?? null,
      connectionId: connection.connectionId,
      timestamp: Date.now()
    });

    switch (message.type) {
      case 'join': {
        await this.handleJoin(socket, message);
        return;
      }
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        if (!connection.peer) {
          this.sendError(socket, 'NOT_IN_ROOM', 'Join room first.');
          return;
        }

        const targetSocket = this.socketsByPeerId.get(message.to);
        if (!targetSocket) {
          const relayPayload: RelayPayload =
            message.type === 'ice-candidate'
              ? {
                  type: 'ice-candidate',
                  to: message.to,
                  from: connection.peer.peerId,
                  roomId: connection.peer.roomId,
                  payload: {
                    type: 'ice-candidate',
                    candidate: message.candidate
                  }
                }
              : {
                  type: message.type,
                  to: message.to,
                  from: connection.peer.peerId,
                  roomId: connection.peer.roomId,
                  payload: {
                    type: message.type,
                    sdp: message.sdp
                  }
                };

          await this.publish({
            kind: 'relay',
            payload: relayPayload
          });
        } else {
          if (message.type === 'ice-candidate') {
            targetSocket.send(
              JSON.stringify({
                type: 'ice-candidate',
                from: connection.peer.peerId,
                candidate: message.candidate
              })
            );
          } else {
            targetSocket.send(
              JSON.stringify({
                type: message.type,
                from: connection.peer.peerId,
                sdp: message.sdp
              })
            );
          }
        }
        return;
      }
      case 'leave': {
        if (!connection.peer) {
          return;
        }

        await this.leaveCurrentRoom(socket);
        return;
      }
    }
  }

  private async handleJoin(
    socket: Socket,
    message: Extract<SignalingInboundMessage, { type: 'join' }>
  ): Promise<void> {
    const connection = socket.getUserData();

    try {
      await verifyRoomToken(message.token, env.JWT_PUBLIC_KEY);
    } catch {
      this.sendError(socket, 'UNAUTHORIZED', 'Invalid room token.');
      socket.close();
      return;
    }

    if (connection.peer && connection.peer.roomId !== message.roomId) {
      await this.leaveCurrentRoom(socket);
    }

    try {
      const existingPeers = await this.roomManager.joinRoom(message.roomId, {
        peerId: message.peerId,
        peerPublicKey: message.peerPublicKey
      });

      connection.authState = 'authenticated';
      connection.peer = {
        peerId: message.peerId,
        roomId: message.roomId,
        peerPublicKey: message.peerPublicKey
      };
      this.socketsByPeerId.set(message.peerId, socket);

      for (const peer of existingPeers) {
        this.send(socket, {
          type: 'peer-joined',
          peerId: peer.peerId,
          peerPublicKey: peer.peerPublicKey
        });
      }

      this.broadcastToRoom(message.roomId, message.peerId, {
        type: 'peer-joined',
        peerId: message.peerId,
        peerPublicKey: message.peerPublicKey
      });
      await this.publish({
        kind: 'broadcast',
        payload: {
          type: 'peer-joined',
          roomId: message.roomId,
          excludedPeerId: message.peerId,
          message: {
            type: 'peer-joined',
            peerId: message.peerId,
            peerPublicKey: message.peerPublicKey
          }
        }
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'ROOM_IS_FULL') {
        this.sendError(socket, 'ROOM_IS_FULL', 'Room capacity reached.');
        return;
      }

      this.sendError(socket, 'JOIN_FAILED', 'Cannot join room.');
    }
  }

  private async leaveCurrentRoom(socket: Socket): Promise<void> {
    const connection = socket.getUserData();
    if (!connection.peer) {
      return;
    }

    const { roomId, peerId } = connection.peer;
    this.socketsByPeerId.delete(peerId);
    await this.roomManager.leaveRoom(roomId, peerId);

    this.broadcastToRoom(roomId, peerId, {
      type: 'peer-left',
      peerId
    });
    await this.publish({
      kind: 'broadcast',
      payload: {
        type: 'peer-left',
        roomId,
        excludedPeerId: peerId,
        message: {
          type: 'peer-left',
          peerId
        }
      }
    });

    connection.peer = undefined;
    connection.authState = 'anonymous';
  }

  private async handleDisconnect(socket: Socket): Promise<void> {
    const connection = socket.getUserData();
    if (connection.peer) {
      await this.leaveCurrentRoom(socket);
    }

    log('info', 'ws_closed', {
      connectionId: connection.connectionId,
      peerId: connection.peer?.peerId ?? null,
      timestamp: Date.now()
    });
  }

  private send(socket: Socket, message: SignalingOutboundMessage): void {
    socket.send(JSON.stringify(message));
  }

  private sendError(socket: Socket, code: string, message: string): void {
    this.send(socket, {
      type: 'error',
      code,
      message
    });
  }

  private broadcastToRoom(
    roomId: string,
    excludedPeerId: string,
    message: SignalingOutboundMessage
  ): void {
    for (const [peerId, peerSocket] of this.socketsByPeerId.entries()) {
      const userData = peerSocket.getUserData();
      if (!userData.peer || userData.peer.roomId !== roomId || peerId === excludedPeerId) {
        continue;
      }

      this.send(peerSocket, message);
    }
  }

  private async initializePubSub(): Promise<void> {
    await this.redisSub.psubscribe('signaling:room:*');

    this.redisSub.on('pmessage', (_pattern, _channel, data) => {
      let event: PubSubEvent;
      try {
        event = JSON.parse(data) as PubSubEvent;
      } catch {
        return;
      }

      if (event.kind === 'relay') {
        const targetSocket = this.socketsByPeerId.get(event.payload.to);
        if (!targetSocket) {
          return;
        }

        targetSocket.send(
          JSON.stringify({
            type: event.payload.type,
            from: event.payload.from,
            ...(event.payload.type === 'ice-candidate'
              ? { candidate: event.payload.payload.candidate }
              : { sdp: event.payload.payload.sdp })
          })
        );
        return;
      }

      this.broadcastToRoom(
        event.payload.roomId,
        event.payload.excludedPeerId,
        event.payload.message
      );
    });
  }

  private async publish(event: PubSubEvent): Promise<void> {
    const roomId = event.kind === 'relay' ? event.payload.roomId : event.payload.roomId;
    await this.redis.publish(`signaling:room:${roomId}`, JSON.stringify(event));
  }

  private extractBearerToken(headerValue: string): string | null {
    if (!headerValue.startsWith('Bearer ')) {
      return null;
    }

    const token = headerValue.slice('Bearer '.length).trim();
    return token.length > 0 ? token : null;
  }

  private writeJson(
    response: {
      writeStatus: (status: string) => unknown;
      writeHeader: (name: string, value: string) => unknown;
      end: (body: string) => void;
    },
    status: number,
    payload: unknown
  ): void {
    this.applyCorsHeaders(response);
    response.writeHeader('Content-Type', 'application/json');
    response.writeStatus(`${status} OK`);
    response.end(JSON.stringify(payload));
  }

  private applyCorsHeaders(response: {
    writeHeader: (name: string, value: string) => unknown;
  }): void {
    response.writeHeader('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN);
    response.writeHeader('Vary', 'Origin');
    response.writeHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.writeHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }
}
