import { z } from 'zod';

export const MAX_SIGNALING_MESSAGE_BYTES = 8 * 1024;
export const MAX_CHAT_MESSAGE_BYTES = 256 * 1024;

export const roomIdSchema = z.string().min(3).max(128);
export const peerIdSchema = z.string().uuid();
export const roomTokenSchema = z.string().min(16);
export const peerPublicKeySchema = z.string().min(1).max(4096);

export type RoomId = z.infer<typeof roomIdSchema>;
export type PeerId = z.infer<typeof peerIdSchema>;

export const joinMessageSchema = z.object({
  type: z.literal('join'),
  roomId: roomIdSchema,
  peerId: peerIdSchema,
  token: roomTokenSchema,
  peerPublicKey: peerPublicKeySchema
});

export const offerMessageSchema = z.object({
  type: z.literal('offer'),
  to: peerIdSchema,
  sdp: z.object({
    type: z.enum(['offer', 'pranswer', 'answer', 'rollback']),
    sdp: z.string().min(1)
  })
});

export const answerMessageSchema = z.object({
  type: z.literal('answer'),
  to: peerIdSchema,
  sdp: z.object({
    type: z.enum(['offer', 'pranswer', 'answer', 'rollback']),
    sdp: z.string().min(1)
  })
});

export const iceCandidateMessageSchema = z.object({
  type: z.literal('ice-candidate'),
  to: peerIdSchema,
  candidate: z.object({
    candidate: z.string(),
    sdpMid: z.string().nullable().optional(),
    sdpMLineIndex: z.number().int().nullable().optional(),
    usernameFragment: z.string().optional()
  })
});

export const leaveMessageSchema = z.object({
  type: z.literal('leave'),
  roomId: roomIdSchema
});

export const signalingInboundSchema = z.discriminatedUnion('type', [
  joinMessageSchema,
  offerMessageSchema,
  answerMessageSchema,
  iceCandidateMessageSchema,
  leaveMessageSchema
]);

export type SignalingInboundMessage = z.infer<typeof signalingInboundSchema>;

export const relayedOfferMessageSchema = z.object({
  type: z.literal('offer'),
  from: peerIdSchema,
  sdp: z.object({
    type: z.enum(['offer', 'pranswer', 'answer', 'rollback']),
    sdp: z.string().min(1)
  })
});

export const relayedAnswerMessageSchema = z.object({
  type: z.literal('answer'),
  from: peerIdSchema,
  sdp: z.object({
    type: z.enum(['offer', 'pranswer', 'answer', 'rollback']),
    sdp: z.string().min(1)
  })
});

export const relayedIceCandidateMessageSchema = z.object({
  type: z.literal('ice-candidate'),
  from: peerIdSchema,
  candidate: z.object({
    candidate: z.string(),
    sdpMid: z.string().nullable().optional(),
    sdpMLineIndex: z.number().int().nullable().optional(),
    usernameFragment: z.string().optional()
  })
});

export const peerJoinedMessageSchema = z.object({
  type: z.literal('peer-joined'),
  peerId: peerIdSchema,
  peerPublicKey: peerPublicKeySchema
});

export const peerLeftMessageSchema = z.object({
  type: z.literal('peer-left'),
  peerId: peerIdSchema
});

export const signalingErrorMessageSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string()
});

export const signalingOutboundSchema = z.discriminatedUnion('type', [
  relayedOfferMessageSchema,
  relayedAnswerMessageSchema,
  relayedIceCandidateMessageSchema,
  peerJoinedMessageSchema,
  peerLeftMessageSchema,
  signalingErrorMessageSchema
]);

export type SignalingOutboundMessage = z.infer<typeof signalingOutboundSchema>;

const baseChatMessageSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.number().int().positive(),
  senderId: peerIdSchema,
  signature: z.string().default('')
});

export const chatTextPayloadSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1).max(4000)
});

export const chatReactionPayloadSchema = z.object({
  type: z.literal('reaction'),
  messageId: z.string().uuid(),
  emoji: z.string().min(1).max(16)
});

export const chatReceiptPayloadSchema = z.object({
  type: z.literal('receipt'),
  messageId: z.string().uuid()
});

export const chatFileMetaPayloadSchema = z.object({
  type: z.literal('file-meta'),
  fileId: z.string().uuid(),
  name: z.string().min(1).max(255),
  size: z.number().int().positive(),
  totalChunks: z.number().int().positive(),
  checksum: z.string().min(1)
});

export const chatFileChunkPayloadSchema = z.object({
  type: z.literal('file-chunk'),
  fileId: z.string().uuid(),
  chunkIndex: z.number().int().min(0),
  data: z.string().min(1).max(40_000)
});

export const chatFileAckPayloadSchema = z.object({
  type: z.literal('file-ack'),
  fileId: z.string().uuid(),
  status: z.enum(['accepted', 'rejected', 'complete']),
  reason: z.string().max(500).optional(),
  missingChunks: z.array(z.number().int().min(0)).max(100_000).optional()
});

export const chatEncryptedPayloadSchema = z.object({
  type: z.literal('encrypted'),
  ivBase64: z.string().min(1).max(256),
  ciphertextBase64: z.string().min(1).max(200_000)
});

export const chatPlainPayloadSchema = z.discriminatedUnion('type', [
  chatTextPayloadSchema,
  chatReactionPayloadSchema,
  chatReceiptPayloadSchema,
  chatFileMetaPayloadSchema,
  chatFileChunkPayloadSchema,
  chatFileAckPayloadSchema
]);

export const chatMessageSchema = baseChatMessageSchema.extend({
  payload: z.discriminatedUnion('type', [
    chatTextPayloadSchema,
    chatReactionPayloadSchema,
    chatReceiptPayloadSchema,
    chatFileMetaPayloadSchema,
    chatFileChunkPayloadSchema,
    chatFileAckPayloadSchema,
    chatEncryptedPayloadSchema
  ])
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;
