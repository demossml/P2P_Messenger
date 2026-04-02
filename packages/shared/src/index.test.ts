import { describe, expect, it } from 'vitest';
import { chatMessageSchema, signalingInboundSchema, signalingOutboundSchema } from './index.js';

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

  it('parses valid join message with peerPublicKey bundle string', () => {
    const bundle = Buffer.from(
      JSON.stringify({
        signingPublicKeySpkiBase64: 'signing-spki-base64',
        ecdhPublicKeySpkiBase64: 'ecdh-spki-base64'
      }),
      'utf8'
    ).toString('base64');

    const message = signalingInboundSchema.parse({
      type: 'join',
      roomId: 'team-room-bundle',
      peerId: '12121212-1212-4121-8121-121212121212',
      token: '1234567890abcdef',
      peerPublicKey: `p2p-key-bundle-v1:${bundle}`
    });

    expect(message.type).toBe('join');
    if (message.type !== 'join') {
      throw new Error('Expected join message.');
    }
    expect(message.peerPublicKey.startsWith('p2p-key-bundle-v1:')).toBe(true);
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

  it('rejects offer with oversized sdp', () => {
    const parsed = signalingInboundSchema.safeParse({
      type: 'offer',
      to: '11111111-1111-4111-8111-111111111111',
      sdp: {
        type: 'offer',
        sdp: 'v=0\r\n'.padEnd(7_501, 'x')
      }
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects ice-candidate with oversized candidate string', () => {
    const parsed = signalingInboundSchema.safeParse({
      type: 'ice-candidate',
      to: '11111111-1111-4111-8111-111111111111',
      candidate: {
        candidate: 'x'.repeat(4_097),
        sdpMid: '0',
        sdpMLineIndex: 0
      }
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects join with oversized peerPublicKey', () => {
    const parsed = signalingInboundSchema.safeParse({
      type: 'join',
      roomId: 'team-room-oversized-key',
      peerId: '13131313-1313-4131-8131-131313131313',
      token: '1234567890abcdef',
      peerPublicKey: 'x'.repeat(4097)
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

  it('rejects peer-joined with oversized peerPublicKey', () => {
    const parsed = signalingOutboundSchema.safeParse({
      type: 'peer-joined',
      peerId: '11111111-1111-4111-8111-111111111111',
      peerPublicKey: 'x'.repeat(4097)
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects relayed answer with oversized sdp', () => {
    const parsed = signalingOutboundSchema.safeParse({
      type: 'answer',
      from: '11111111-1111-4111-8111-111111111111',
      sdp: {
        type: 'answer',
        sdp: 'x'.repeat(7_501)
      }
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects relayed ice-candidate with oversized usernameFragment', () => {
    const parsed = signalingOutboundSchema.safeParse({
      type: 'ice-candidate',
      from: '11111111-1111-4111-8111-111111111111',
      candidate: {
        candidate: 'candidate:1 1 UDP 2122252543 192.168.1.2 12345 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: 'x'.repeat(257)
      }
    });

    expect(parsed.success).toBe(false);
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

  it('parses encrypted payload envelope', () => {
    const parsed = chatMessageSchema.parse({
      id: '77777777-7777-4777-8777-777777777777',
      timestamp: Date.now(),
      senderId: '88888888-8888-4888-8888-888888888888',
      signature: 'base64-signature',
      payload: {
        type: 'encrypted',
        ivBase64: 'YWJj',
        ciphertextBase64: 'ZGVm'
      }
    });

    expect(parsed.payload.type).toBe('encrypted');
  });

  it('rejects encrypted payload with oversized iv', () => {
    const parsed = chatMessageSchema.safeParse({
      id: '99999999-9999-4999-8999-999999999999',
      timestamp: Date.now(),
      senderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      signature: 'base64-signature',
      payload: {
        type: 'encrypted',
        ivBase64: 'x'.repeat(257),
        ciphertextBase64: 'ok'
      }
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects encrypted payload with oversized ciphertext', () => {
    const parsed = chatMessageSchema.safeParse({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      timestamp: Date.now(),
      senderId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      signature: 'base64-signature',
      payload: {
        type: 'encrypted',
        ivBase64: 'ok',
        ciphertextBase64: 'x'.repeat(200_001)
      }
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects encrypted payload with non-string fields', () => {
    const parsed = chatMessageSchema.safeParse({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      timestamp: Date.now(),
      senderId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      signature: 'base64-signature',
      payload: {
        type: 'encrypted',
        ivBase64: 123,
        ciphertextBase64: true
      }
    });

    expect(parsed.success).toBe(false);
  });
});
