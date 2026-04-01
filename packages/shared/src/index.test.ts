import { describe, expect, it } from 'vitest';
import {
  chatMessageSchema,
  signalingInboundSchema,
  signalingOutboundSchema
} from './index.js';

describe('signalingInboundSchema', () => {
  it('parses valid join message', () => {
    const message = signalingInboundSchema.parse({
      type: 'join',
      roomId: 'team-room',
      peerId: '11111111-1111-4111-8111-111111111111',
      token: '1234567890abcdef',
      peerPublicKey: 'spki-public-key'
    });

    expect(message.type).toBe('join');
  });

  it('rejects invalid candidate payload type', () => {
    const parsed = signalingInboundSchema.safeParse({
      type: 'ice-candidate',
      to: '11111111-1111-4111-8111-111111111111',
      candidate: {
        candidate: 'candidate:1 1 UDP 2122252543 192.168.1.2 12345 typ host',
        sdpMLineIndex: '0'
      }
    });

    expect(parsed.success).toBe(false);
  });
});

describe('signalingOutboundSchema', () => {
  it('parses peer-joined broadcast message', () => {
    const message = signalingOutboundSchema.parse({
      type: 'peer-joined',
      peerId: '11111111-1111-4111-8111-111111111111',
      peerPublicKey: 'spki-key'
    });

    expect(message.type).toBe('peer-joined');
  });
});

describe('chatMessageSchema', () => {
  it('parses signed text message', () => {
    const parsed = chatMessageSchema.parse({
      id: '22222222-2222-4222-8222-222222222222',
      timestamp: Date.now(),
      senderId: '33333333-3333-4333-8333-333333333333',
      signature: 'base64-signature',
      payload: {
        type: 'text',
        text: 'hello'
      }
    });

    expect(parsed.payload.type).toBe('text');
  });

  it('rejects oversized file chunk data', () => {
    const parsed = chatMessageSchema.safeParse({
      id: '44444444-4444-4444-8444-444444444444',
      timestamp: Date.now(),
      senderId: '55555555-5555-4555-8555-555555555555',
      signature: 'base64-signature',
      payload: {
        type: 'file-chunk',
        fileId: '66666666-6666-4666-8666-666666666666',
        chunkIndex: 0,
        data: 'x'.repeat(40001)
      }
    });

    expect(parsed.success).toBe(false);
  });
});
