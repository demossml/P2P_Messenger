import { useEffect, useMemo, useRef, useState } from 'react';
import {
  assessConnectionQuality,
  PeerManager,
  setVideoBitrate,
  SignalingTransport,
  type ConnectionQuality
} from '@p2p/webrtc';
import {
  bytesToBase64,
  deriveSharedAes256GcmKey,
  deserializeSigningKeyPair,
  exportEcdhPrivateKeyBase64,
  exportEcdhPublicKeyBase64,
  generateEcdhKeyPair,
  generateSigningKeyPair,
  importEcdhPrivateKeyBase64,
  importEcdhPublicKeyBase64,
  importSigningPublicKeyBase64,
  publicKeyFingerprint,
  serializeSigningKeyPair,
  signBytes,
  verifyBytes
} from '@p2p/crypto';
import type { ChatMessage } from '@p2p/shared';
import {
  assembleChunkMapToBytes,
  buildMissingChunkIndexes,
  computeTotalChunks,
  DEFAULT_FILE_CHUNK_SIZE_BYTES
} from './file-transfer-utils.js';
import {
  migrateSigningIdentityFromSessionStorage,
  readSigningIdentityFromIndexedDb,
  writeSigningIdentityToIndexedDb
} from './signing-key-store.js';
import {
  decodePeerPublicKeyBundle,
  decryptPayloadWithSharedKey,
  encodePeerPublicKeyBundle,
  encryptPayloadWithSharedKey
} from './chat-payload-crypto.js';
import {
  readRoomIdFromSessionStorage,
  ROOM_ID_KEY,
  writeRoomIdToSessionStorage
} from './room-storage.js';

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

type RemoteStreamEntry = {
  peerId: string;
  stream: MediaStream;
};

type PeerFingerprintEntry = {
  peerId: string;
  fingerprint: string;
};

type ChatEntry = {
  id: string;
  senderId: string;
  text: string;
  timestamp: number;
  incoming: boolean;
  readBy: string[];
  reactions: Array<{
    senderId: string;
    emoji: string;
  }>;
};

type FileTransferEntry = {
  fileId: string;
  name: string;
  size: number;
  totalChunks: number;
  receivedChunks: number;
  status: 'sending' | 'receiving' | 'completed' | 'failed' | 'partial';
  checksum: string;
  error?: string;
  downloadUrl?: string;
  peerStates: Array<{
    peerId: string;
    status: 'pending' | 'accepted' | 'completed' | 'rejected' | 'timeout';
    sentChunks: number;
    totalChunks: number;
    lastUpdateAt: number;
    error?: string;
  }>;
};

type ConnectionStatsState = {
  quality: ConnectionQuality;
  packetLossPercent: number;
  rttMs: number | null;
  jitterMs: number | null;
  relayFallbackRecommended: boolean;
};

type PeerConnectionQualityEntry = {
  peerId: string;
  quality: ConnectionQuality;
  packetLossPercent: number;
  rttMs: number | null;
  jitterMs: number | null;
};

type PreferredDevices = {
  audioInputId: string;
  videoInputId: string;
  audioOutputId: string;
};

type OutgoingFileTransfer = {
  file: File;
  fileBuffer: ArrayBuffer;
  fileId: string;
  name: string;
  size: number;
  totalChunks: number;
  checksum: string;
};

type OutgoingPeerAckState = {
  acknowledged: boolean;
  completed: boolean;
  rejected: boolean;
  retryCount: number;
  lastMetaSentAt: number;
  sentChunkIndexes: Set<number>;
  error?: string;
};

const PEER_ID_KEY = 'p2p.peerId';
const PEER_PUBLIC_KEY_KEY = 'p2p.peerPublicKey';
const PEER_PRIVATE_KEY_KEY = 'p2p.peerPrivateKey';
const ACCESS_TOKEN_KEY = 'p2p.accessToken';
const REFRESH_TOKEN_KEY = 'p2p.refreshToken';
const PREFERRED_AUDIO_INPUT_KEY = 'p2p.prefAudioInputId';
const PREFERRED_VIDEO_INPUT_KEY = 'p2p.prefVideoInputId';
const PREFERRED_AUDIO_OUTPUT_KEY = 'p2p.prefAudioOutputId';
const FILE_META_ACK_TIMEOUT_MS = 8000;
const FILE_META_HEARTBEAT_MS = 5000;
const FILE_META_MAX_RETRIES = 5;
const MAX_CHAT_TEXT_LENGTH = 4000;
const MAX_REACTION_LENGTH = 16;
const RELAY_ENABLE_STREAK_REQUIRED = 2;
const RELAY_DISABLE_STREAK_REQUIRED = 4;
const RELAY_TOGGLE_COOLDOWN_MS = 15_000;
const CHAT_SEND_RETRY_ATTEMPTS = 20;
const CHAT_SEND_RETRY_DELAY_MS = 250;

function getOrCreateStorageValue(key: string, fallbackFactory: () => string): string {
  const existingValue = sessionStorage.getItem(key);
  if (existingValue) {
    return existingValue;
  }

  const fallbackValue = fallbackFactory();
  sessionStorage.setItem(key, fallbackValue);
  return fallbackValue;
}

function defaultSignalingUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.hostname || 'localhost';
  return `${protocol}://${host}:3001/ws`;
}

function defaultApiBaseUrl(): string {
  const protocol = window.location.protocol;
  const host = window.location.hostname || 'localhost';
  return `${protocol}//${host}:3001`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function parseJwtPayload(token: string): { exp?: number } | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const payloadSegment = parts[1];
  if (!payloadSegment) {
    return null;
  }

  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    return JSON.parse(json) as { exp?: number };
  } catch {
    return null;
  }
}

function isTokenExpired(token: string, skewSeconds = 30): boolean {
  const payload = parseJwtPayload(token);
  if (!payload?.exp) {
    return true;
  }

  const now = Math.floor(Date.now() / 1000);
  return payload.exp <= now + skewSeconds;
}

async function sha256Hex(input: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', input);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function normalizeChunkIndexes(chunkIndexes: number[], totalChunks: number): number[] {
  const normalized = new Set<number>();

  for (const chunkIndex of chunkIndexes) {
    if (!Number.isInteger(chunkIndex)) {
      continue;
    }
    if (chunkIndex < 0 || chunkIndex >= totalChunks) {
      continue;
    }
    normalized.add(chunkIndex);
  }

  return Array.from(normalized).sort((left, right) => left - right);
}

export function useSignaling(): {
  status: ConnectionStatus;
  roomId: string;
  setRoomId: (value: string) => void;
  remotePeerCount: number;
  localStream: MediaStream | null;
  remoteStreams: RemoteStreamEntry[];
  isLocalMediaReady: boolean;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  connectionQuality: ConnectionQuality;
  packetLossPercent: number;
  rttMs: number | null;
  jitterMs: number | null;
  relayFallbackRecommended: boolean;
  relayModeEnabled: boolean;
  networkNotice: string | null;
  peerConnectionQualities: PeerConnectionQualityEntry[];
  preferredDevices: PreferredDevices;
  setPreferredDevices: (next: Partial<PreferredDevices>) => void;
  chatMessages: ChatEntry[];
  fileTransfers: FileTransferEntry[];
  localFingerprint: string | null;
  remoteFingerprints: PeerFingerprintEntry[];
  lastError: string | null;
  connect: () => void;
  disconnect: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => Promise<void>;
  sendChatText: (text: string) => void;
  sendReaction: (messageId: string, emoji: string) => void;
  sendFile: (file: File) => Promise<void>;
} {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const [roomId, setRoomIdState] = useState<string>(() => readRoomIdFromSessionStorage());
  const [remotePeerCount, setRemotePeerCount] = useState<number>(0);
  const [isLocalMediaReady, setIsLocalMediaReady] = useState<boolean>(false);
  const [localStreamState, setLocalStreamState] = useState<MediaStream | null>(null);
  const [remoteStreamsState, setRemoteStreamsState] = useState<RemoteStreamEntry[]>([]);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isCameraOff, setIsCameraOff] = useState<boolean>(false);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [chatMessages, setChatMessages] = useState<ChatEntry[]>([]);
  const [fileTransfers, setFileTransfers] = useState<FileTransferEntry[]>([]);
  const [connectionStats, setConnectionStats] = useState<ConnectionStatsState>({
    quality: 'good',
    packetLossPercent: 0,
    rttMs: null,
    jitterMs: null,
    relayFallbackRecommended: false
  });
  const [relayModeEnabled, setRelayModeEnabled] = useState<boolean>(false);
  const [networkNotice, setNetworkNotice] = useState<string | null>(null);
  const [peerConnectionQualities, setPeerConnectionQualities] = useState<
    PeerConnectionQualityEntry[]
  >([]);
  const [preferredDevices, setPreferredDevicesState] = useState<PreferredDevices>({
    audioInputId: localStorage.getItem(PREFERRED_AUDIO_INPUT_KEY) ?? '',
    videoInputId: localStorage.getItem(PREFERRED_VIDEO_INPUT_KEY) ?? '',
    audioOutputId: localStorage.getItem(PREFERRED_AUDIO_OUTPUT_KEY) ?? ''
  });
  const [localFingerprint, setLocalFingerprint] = useState<string | null>(null);
  const [remoteFingerprints, setRemoteFingerprints] = useState<PeerFingerprintEntry[]>([]);
  const [peerPublicKey, setPeerPublicKey] = useState<string>('');
  const [isSigningReady, setIsSigningReady] = useState<boolean>(false);

  const transportRef = useRef<SignalingTransport | null>(null);
  const peerManagerRef = useRef<PeerManager | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const remotePeerIdsRef = useRef<Set<string>>(new Set());
  const remoteStreamsMapRef = useRef<Map<string, MediaStream>>(new Map());
  const incomingFileMetaRef = useRef<Map<string, FileTransferEntry>>(new Map());
  const incomingFileChunksRef = useRef<Map<string, Map<number, string>>>(new Map());
  const outgoingTransfersRef = useRef<Map<string, OutgoingFileTransfer>>(new Map());
  const outgoingTransferPeerStateRef = useRef<Map<string, Map<string, OutgoingPeerAckState>>>(
    new Map()
  );
  const signingPrivateKeyRef = useRef<CryptoKey | null>(null);
  const ecdhPrivateKeyRef = useRef<CryptoKey | null>(null);
  const remotePeerPublicKeySpkiRef = useRef<Map<string, string>>(new Map());
  const remotePeerEcdhPublicKeySpkiRef = useRef<Map<string, string>>(new Map());
  const remotePeerVerifyKeyRef = useRef<Map<string, CryptoKey>>(new Map());
  const sharedEncryptionKeysRef = useRef<Map<string, CryptoKey>>(new Map());
  const remotePeerFingerprintRef = useRef<Map<string, string>>(new Map());
  const bitrateByPeerRef = useRef<Map<string, number>>(new Map());
  const statsTrackingStartedAtRef = useRef<number | null>(null);
  const lastQualityRef = useRef<ConnectionQuality>('good');
  const relayEnableStreakRef = useRef<number>(0);
  const relayDisableStreakRef = useRef<number>(0);
  const relayToggleInFlightRef = useRef<boolean>(false);
  const lastRelayToggleAtRef = useRef<number>(0);

  function setPreferredDevices(next: Partial<PreferredDevices>): void {
    setPreferredDevicesState((current) => {
      const updated: PreferredDevices = {
        ...current,
        ...next
      };

      localStorage.setItem(PREFERRED_AUDIO_INPUT_KEY, updated.audioInputId);
      localStorage.setItem(PREFERRED_VIDEO_INPUT_KEY, updated.videoInputId);
      localStorage.setItem(PREFERRED_AUDIO_OUTPUT_KEY, updated.audioOutputId);
      return updated;
    });
  }

  function setRoomId(value: string): void {
    setRoomIdState(value);
    writeRoomIdToSessionStorage(value);
  }

  function syncRemoteFingerprintsState(): void {
    setRemoteFingerprints(
      Array.from(remotePeerFingerprintRef.current.entries())
        .map(([peerId, fingerprint]) => ({
          peerId,
          fingerprint
        }))
        .sort((left, right) => left.peerId.localeCompare(right.peerId))
    );
  }

  async function getOrCreateSharedEncryptionKey(peerId: string): Promise<CryptoKey | null> {
    const existingKey = sharedEncryptionKeysRef.current.get(peerId);
    if (existingKey) {
      return existingKey;
    }

    const localPrivate = ecdhPrivateKeyRef.current;
    const peerPublicSpki = remotePeerEcdhPublicKeySpkiRef.current.get(peerId);
    if (!localPrivate || !peerPublicSpki) {
      return null;
    }

    const peerPublicKey = await importEcdhPublicKeyBase64(peerPublicSpki);
    const sharedKey = await deriveSharedAes256GcmKey(localPrivate, peerPublicKey);
    sharedEncryptionKeysRef.current.set(peerId, sharedKey);
    return sharedKey;
  }

  async function encryptPayloadForPeer(
    peerId: string,
    payload: ChatMessage['payload']
  ): Promise<ChatMessage['payload']> {
    const sharedKey = await getOrCreateSharedEncryptionKey(peerId);
    return encryptPayloadWithSharedKey(payload, sharedKey);
  }

  async function decryptPayloadFromPeer(
    peerId: string,
    payload: ChatMessage['payload']
  ): Promise<ChatMessage['payload'] | null> {
    const sharedKey = await getOrCreateSharedEncryptionKey(peerId);
    const decrypted = await decryptPayloadWithSharedKey(payload, sharedKey);
    if (decrypted.error) {
      setLastError(`Failed to decrypt message from ${peerId.slice(0, 8)}: ${decrypted.error}`);
      return null;
    }

    return decrypted.payload;
  }

  async function createSignedMessageForPeer(
    peerId: string,
    payload: ChatMessage['payload'],
    options?: {
      id?: string;
      timestamp?: number;
    }
  ): Promise<ChatMessage> {
    const privateKey = signingPrivateKeyRef.current;
    if (!privateKey) {
      throw new Error('Signing key is not initialized yet.');
    }

    const payloadForMessage = await encryptPayloadForPeer(peerId, payload);
    const unsigned = {
      id: options?.id ?? crypto.randomUUID(),
      timestamp: options?.timestamp ?? Date.now(),
      senderId: identity.peerId,
      payload: payloadForMessage
    };

    const signature = await signBytes(
      privateKey,
      new TextEncoder().encode(JSON.stringify(unsigned))
    );
    return {
      ...unsigned,
      signature
    };
  }

  async function rememberRemotePeerKey(peerId: string, publicKeyBundleRaw: string): Promise<void> {
    const bundle = decodePeerPublicKeyBundle(publicKeyBundleRaw);

    remotePeerPublicKeySpkiRef.current.set(peerId, bundle.signingPublicKeySpkiBase64);
    if (bundle.ecdhPublicKeySpkiBase64) {
      remotePeerEcdhPublicKeySpkiRef.current.set(peerId, bundle.ecdhPublicKeySpkiBase64);
    } else {
      remotePeerEcdhPublicKeySpkiRef.current.delete(peerId);
    }
    sharedEncryptionKeysRef.current.delete(peerId);

    const verifyKey = await importSigningPublicKeyBase64(bundle.signingPublicKeySpkiBase64);
    remotePeerVerifyKeyRef.current.set(peerId, verifyKey);
    const fingerprint = await publicKeyFingerprint(bundle.signingPublicKeySpkiBase64);
    remotePeerFingerprintRef.current.set(peerId, fingerprint);
    syncRemoteFingerprintsState();
  }

  async function verifyIncomingMessage(peerId: string, message: ChatMessage): Promise<boolean> {
    if (message.senderId !== peerId) {
      setLastError(`Rejected forged message: senderId ${message.senderId} != peer ${peerId}.`);
      return false;
    }

    let verifyKey = remotePeerVerifyKeyRef.current.get(peerId);
    if (!verifyKey) {
      const publicKeySpkiBase64 = remotePeerPublicKeySpkiRef.current.get(peerId);
      if (!publicKeySpkiBase64) {
        setLastError(`Missing public key for peer ${peerId.slice(0, 8)}.`);
        return false;
      }

      try {
        verifyKey = await importSigningPublicKeyBase64(publicKeySpkiBase64);
        remotePeerVerifyKeyRef.current.set(peerId, verifyKey);
      } catch (error) {
        setLastError(
          error instanceof Error
            ? error.message
            : `Failed to import public key for ${peerId.slice(0, 8)}.`
        );
        return false;
      }
    }

    const unsigned = {
      id: message.id,
      timestamp: message.timestamp,
      senderId: message.senderId,
      payload: message.payload
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(unsigned));
    const isValid = await verifyBytes(verifyKey, payloadBytes, message.signature);
    if (!isValid) {
      setLastError(`Rejected message with invalid signature from ${peerId.slice(0, 8)}.`);
      return false;
    }

    return true;
  }

  function getOrCreatePeerAckState(fileId: string, peerId: string): OutgoingPeerAckState {
    let byPeer = outgoingTransferPeerStateRef.current.get(fileId);
    if (!byPeer) {
      byPeer = new Map();
      outgoingTransferPeerStateRef.current.set(fileId, byPeer);
    }

    let state = byPeer.get(peerId);
    if (!state) {
      state = {
        acknowledged: false,
        completed: false,
        rejected: false,
        retryCount: 0,
        lastMetaSentAt: 0,
        sentChunkIndexes: new Set<number>()
      };
      byPeer.set(peerId, state);
    }

    return state;
  }

  function buildPeerStates(fileId: string, totalChunks: number): FileTransferEntry['peerStates'] {
    const peerStates = outgoingTransferPeerStateRef.current.get(fileId);
    if (!peerStates) {
      return [];
    }

    return Array.from(peerStates.entries()).map(([peerId, state]) => {
      let status: FileTransferEntry['peerStates'][number]['status'] = 'pending';
      if (state.completed) {
        status = 'completed';
      } else if (state.rejected) {
        status = state.error ? 'timeout' : 'rejected';
      } else if (state.acknowledged) {
        status = 'accepted';
      }

      return {
        peerId,
        status,
        sentChunks: state.sentChunkIndexes.size,
        totalChunks,
        lastUpdateAt: state.lastMetaSentAt,
        ...(state.error
          ? {
              error: state.error
            }
          : {})
      };
    });
  }

  function syncOutgoingTransferUi(fileId: string): void {
    setFileTransfers((current) =>
      current.map((entry) => {
        if (entry.fileId !== fileId) {
          return entry;
        }

        const peerStates = buildPeerStates(fileId, entry.totalChunks);
        const receivedChunks =
          peerStates.length > 0
            ? Math.max(...peerStates.map((state) => state.sentChunks))
            : entry.receivedChunks;

        return {
          ...entry,
          peerStates,
          receivedChunks
        };
      })
    );
  }

  function finalizeOutgoingTransferStatus(fileId: string): void {
    const peerStates = outgoingTransferPeerStateRef.current.get(fileId);
    if (!peerStates || peerStates.size === 0) {
      return;
    }

    const allCompleted = Array.from(peerStates.values()).every((state) => state.completed);
    const anyRejected = Array.from(peerStates.values()).some((state) => state.rejected);
    const anyCompleted = Array.from(peerStates.values()).some((state) => state.completed);

    if (anyRejected) {
      const firstRejectedError =
        Array.from(peerStates.values()).find((state) => state.rejected && state.error)?.error ??
        null;
      setFileTransfers((current) =>
        current.map((entry) =>
          entry.fileId === fileId
            ? {
                ...entry,
                status: anyCompleted ? 'partial' : 'failed',
                error: firstRejectedError
                  ? firstRejectedError
                  : anyCompleted
                    ? 'File delivered partially: some peers failed or timed out.'
                    : 'One or more peers rejected or timed out during transfer.'
              }
            : entry
        )
      );
      if (!anyCompleted) {
        outgoingTransfersRef.current.delete(fileId);
        outgoingTransferPeerStateRef.current.delete(fileId);
      }
      syncOutgoingTransferUi(fileId);
      return;
    }

    if (!allCompleted) {
      return;
    }

    setFileTransfers((current) =>
      current.map((entry) =>
        entry.fileId === fileId
          ? {
              ...entry,
              status: 'completed'
            }
          : entry
      )
    );
    outgoingTransfersRef.current.delete(fileId);
    outgoingTransferPeerStateRef.current.delete(fileId);
    syncOutgoingTransferUi(fileId);
  }

  async function sendChatMessageWithRetry(
    peerId: string,
    message: ChatMessage,
    attempts = CHAT_SEND_RETRY_ATTEMPTS
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const manager = peerManagerRef.current;
      if (!manager) {
        return false;
      }

      const sent = await manager.sendChatMessage(peerId, message);
      if (sent) {
        return true;
      }

      if (attempt < attempts) {
        await sleep(CHAT_SEND_RETRY_DELAY_MS);
      }
    }

    return false;
  }

  async function sendFileMetaToPeer(
    peerId: string,
    transfer: OutgoingFileTransfer
  ): Promise<boolean> {
    const manager = peerManagerRef.current;
    if (!manager || !manager.hasOpenChatChannel(peerId)) {
      return false;
    }

    const message = await createSignedMessageForPeer(peerId, {
      type: 'file-meta',
      fileId: transfer.fileId,
      name: transfer.name,
      size: transfer.size,
      totalChunks: transfer.totalChunks,
      checksum: transfer.checksum
    });
    const sent = await sendChatMessageWithRetry(peerId, message);
    if (!sent) {
      return false;
    }

    const peerState = getOrCreatePeerAckState(transfer.fileId, peerId);
    peerState.lastMetaSentAt = Date.now();
    return true;
  }

  async function sendFileChunksToPeer(
    peerId: string,
    transfer: OutgoingFileTransfer,
    chunkIndexes: number[]
  ): Promise<void> {
    const manager = peerManagerRef.current;
    if (!manager || !manager.hasOpenChatChannel(peerId)) {
      return;
    }

    const safeChunkIndexes = normalizeChunkIndexes(chunkIndexes, transfer.totalChunks);
    for (const chunkIndex of safeChunkIndexes) {
      const start = chunkIndex * DEFAULT_FILE_CHUNK_SIZE_BYTES;
      const end = Math.min(start + DEFAULT_FILE_CHUNK_SIZE_BYTES, transfer.size);
      const chunkBuffer = transfer.fileBuffer.slice(start, end);
      const chunkData = bytesToBase64(new Uint8Array(chunkBuffer));

      const message = await createSignedMessageForPeer(peerId, {
        type: 'file-chunk',
        fileId: transfer.fileId,
        chunkIndex,
        data: chunkData
      });
      const sent = await sendChatMessageWithRetry(peerId, message);
      if (!sent) {
        return;
      }

      const peerState = getOrCreatePeerAckState(transfer.fileId, peerId);
      peerState.sentChunkIndexes.add(chunkIndex);
      syncOutgoingTransferUi(transfer.fileId);
    }
  }

  async function reannouncePendingTransfersToPeer(peerId: string): Promise<void> {
    for (const transfer of outgoingTransfersRef.current.values()) {
      const peerState = getOrCreatePeerAckState(transfer.fileId, peerId);
      if (peerState.completed || peerState.rejected) {
        continue;
      }

      peerState.acknowledged = false;
      peerState.retryCount = 0;
      peerState.lastMetaSentAt = 0;
      await sendFileMetaToPeer(peerId, transfer);
    }
  }

  async function retryPendingFileMetaAcks(): Promise<void> {
    const now = Date.now();
    for (const [fileId, transfer] of outgoingTransfersRef.current.entries()) {
      const byPeer = outgoingTransferPeerStateRef.current.get(fileId);
      if (!byPeer) {
        continue;
      }

      for (const [peerId, state] of byPeer.entries()) {
        if (state.acknowledged || state.completed || state.rejected) {
          continue;
        }

        if (state.retryCount >= FILE_META_MAX_RETRIES) {
          state.rejected = true;
          state.error = `No file-ack from peer ${peerId.slice(0, 8)} after retries.`;
          finalizeOutgoingTransferStatus(fileId);
          continue;
        }

        if (now - state.lastMetaSentAt < FILE_META_ACK_TIMEOUT_MS) {
          continue;
        }

        const sent = await sendFileMetaToPeer(peerId, transfer);
        if (sent) {
          state.retryCount += 1;
        }
      }
    }
  }

  const identity = useMemo(
    () => ({
      peerId: getOrCreateStorageValue(PEER_ID_KEY, () => crypto.randomUUID())
    }),
    []
  );

  useEffect(() => {
    void (async () => {
      try {
        const migrated = await migrateSigningIdentityFromSessionStorage(
          PEER_PUBLIC_KEY_KEY,
          PEER_PRIVATE_KEY_KEY
        ).catch(() => null);
        const storedIdentity =
          migrated ?? (await readSigningIdentityFromIndexedDb().catch(() => null));

        if (storedIdentity) {
          const signingKeyPair = await deserializeSigningKeyPair({
            publicKeySpkiBase64: storedIdentity.publicKeySpkiBase64,
            privateKeyPkcs8Base64: storedIdentity.privateKeyPkcs8Base64
          });
          signingPrivateKeyRef.current = signingKeyPair.privateKey;

          let ecdhPublicKeySpkiBase64 = storedIdentity.ecdhPublicKeySpkiBase64;
          if (storedIdentity.ecdhPrivateKeyPkcs8Base64 && storedIdentity.ecdhPublicKeySpkiBase64) {
            ecdhPrivateKeyRef.current = await importEcdhPrivateKeyBase64(
              storedIdentity.ecdhPrivateKeyPkcs8Base64
            );
          } else {
            const ecdhKeyPair = await generateEcdhKeyPair(true);
            ecdhPrivateKeyRef.current = ecdhKeyPair.privateKey;
            ecdhPublicKeySpkiBase64 = await exportEcdhPublicKeyBase64(ecdhKeyPair.publicKey);
            const ecdhPrivateKeyPkcs8Base64 = await exportEcdhPrivateKeyBase64(
              ecdhKeyPair.privateKey
            );
            await writeSigningIdentityToIndexedDb({
              ...storedIdentity,
              ecdhPublicKeySpkiBase64,
              ecdhPrivateKeyPkcs8Base64
            });
          }

          setPeerPublicKey(
            encodePeerPublicKeyBundle({
              signingPublicKeySpkiBase64: storedIdentity.publicKeySpkiBase64,
              ...(ecdhPublicKeySpkiBase64 ? { ecdhPublicKeySpkiBase64 } : {})
            })
          );
          setLocalFingerprint(await publicKeyFingerprint(storedIdentity.publicKeySpkiBase64));
          setIsSigningReady(true);
          return;
        }

        const generatedKeyPair = await generateSigningKeyPair(true);
        const ecdhKeyPair = await generateEcdhKeyPair(true);
        const serialized = await serializeSigningKeyPair(generatedKeyPair);
        const ecdhPublicKeySpkiBase64 = await exportEcdhPublicKeyBase64(ecdhKeyPair.publicKey);
        const ecdhPrivateKeyPkcs8Base64 = await exportEcdhPrivateKeyBase64(ecdhKeyPair.privateKey);
        await writeSigningIdentityToIndexedDb({
          ...serialized,
          ecdhPublicKeySpkiBase64,
          ecdhPrivateKeyPkcs8Base64
        });
        signingPrivateKeyRef.current = generatedKeyPair.privateKey;
        ecdhPrivateKeyRef.current = ecdhKeyPair.privateKey;
        setPeerPublicKey(
          encodePeerPublicKeyBundle({
            signingPublicKeySpkiBase64: serialized.publicKeySpkiBase64,
            ecdhPublicKeySpkiBase64
          })
        );
        setLocalFingerprint(await publicKeyFingerprint(serialized.publicKeySpkiBase64));
        setIsSigningReady(true);
      } catch (error) {
        setLastError(
          error instanceof Error ? error.message : 'Failed to initialize signing identity.'
        );
      }
    })();
  }, []);

  const transport = useMemo(() => {
    return new SignalingTransport({
      url: defaultSignalingUrl(),
      peerId: identity.peerId,
      peerPublicKey: peerPublicKey || 'pending',
      roomStorageKey: ROOM_ID_KEY,
      getToken: async () => {
        const apiBaseUrl = defaultApiBaseUrl();
        const accessToken = sessionStorage.getItem(ACCESS_TOKEN_KEY);
        if (accessToken && !isTokenExpired(accessToken)) {
          return accessToken;
        }

        const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY);
        if (refreshToken && !isTokenExpired(refreshToken)) {
          const refreshResult = await fetch(
            `${apiBaseUrl}/auth/refresh?token=${encodeURIComponent(refreshToken)}`
          );
          if (refreshResult.ok) {
            const refreshed = (await refreshResult.json()) as {
              accessToken: string;
              refreshToken: string;
            };
            sessionStorage.setItem(ACCESS_TOKEN_KEY, refreshed.accessToken);
            sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshed.refreshToken);
            return refreshed.accessToken;
          }
        }

        const loginResult = await fetch(`${apiBaseUrl}/auth/dev-login?userId=demo-user`);
        if (!loginResult.ok) {
          throw new Error('Failed to fetch auth token from /auth/dev-login.');
        }

        const session = (await loginResult.json()) as {
          accessToken: string;
          refreshToken: string;
        };

        sessionStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
        sessionStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
        return session.accessToken;
      },
      onStatus: (nextStatus) => {
        setStatus(nextStatus);
      },
      onMessage: (message) => {
        setLastError(null);
        if (message.type === 'peer-joined') {
          void rememberRemotePeerKey(message.peerId, message.peerPublicKey).catch((error) => {
            setLastError(
              error instanceof Error
                ? error.message
                : `Failed to cache peer key for ${message.peerId.slice(0, 8)}.`
            );
          });
          window.setTimeout(() => {
            void reannouncePendingTransfersToPeer(message.peerId);
          }, 1200);
        }
        if (message.type === 'peer-left') {
          remotePeerPublicKeySpkiRef.current.delete(message.peerId);
          remotePeerEcdhPublicKeySpkiRef.current.delete(message.peerId);
          remotePeerVerifyKeyRef.current.delete(message.peerId);
          sharedEncryptionKeysRef.current.delete(message.peerId);
          remotePeerFingerprintRef.current.delete(message.peerId);
          syncRemoteFingerprintsState();
        }
        void peerManagerRef.current?.handleSignalingMessage(message);
      },
      onError: (error) => {
        setLastError(error.message);
      }
    });
  }, [identity.peerId, peerPublicKey]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void retryPendingFileMetaAcks();
    }, FILE_META_HEARTBEAT_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const manager = peerManagerRef.current;
    if (!manager || remotePeerIdsRef.current.size === 0) {
      relayEnableStreakRef.current = 0;
      relayDisableStreakRef.current = 0;
      if (relayModeEnabled) {
        setRelayModeEnabled(false);
      }
      return;
    }

    const now = Date.now();
    const inCooldown = now - lastRelayToggleAtRef.current < RELAY_TOGGLE_COOLDOWN_MS;

    if (connectionStats.relayFallbackRecommended) {
      relayEnableStreakRef.current += 1;
      relayDisableStreakRef.current = 0;
    } else if (connectionStats.quality === 'good') {
      relayDisableStreakRef.current += 1;
      relayEnableStreakRef.current = 0;
    } else {
      relayEnableStreakRef.current = 0;
      relayDisableStreakRef.current = 0;
    }

    if (
      !relayModeEnabled &&
      relayEnableStreakRef.current >= RELAY_ENABLE_STREAK_REQUIRED &&
      !inCooldown &&
      !relayToggleInFlightRef.current
    ) {
      relayToggleInFlightRef.current = true;
      void (async () => {
        try {
          await manager.setRelayMode(true);
          setRelayModeEnabled(true);
          lastRelayToggleAtRef.current = Date.now();
          relayEnableStreakRef.current = 0;
          setNetworkNotice('Relay mode enabled for better stability on weak network conditions.');
        } catch (error) {
          setLastError(error instanceof Error ? error.message : 'Failed to enable relay mode.');
        } finally {
          relayToggleInFlightRef.current = false;
        }
      })();
      return;
    }

    if (
      relayModeEnabled &&
      relayDisableStreakRef.current >= RELAY_DISABLE_STREAK_REQUIRED &&
      !inCooldown &&
      !relayToggleInFlightRef.current
    ) {
      relayToggleInFlightRef.current = true;
      void (async () => {
        try {
          await manager.setRelayMode(false);
          setRelayModeEnabled(false);
          lastRelayToggleAtRef.current = Date.now();
          relayDisableStreakRef.current = 0;
          setNetworkNotice('Relay mode disabled, direct path restored.');
        } catch (error) {
          setLastError(error instanceof Error ? error.message : 'Failed to disable relay mode.');
        } finally {
          relayToggleInFlightRef.current = false;
        }
      })();
    }
  }, [connectionStats.quality, connectionStats.relayFallbackRecommended, relayModeEnabled]);

  useEffect(() => {
    const manager = new PeerManager({
      localPeerId: identity.peerId,
      transport,
      onPeerConnected: (peerId) => {
        remotePeerIdsRef.current.add(peerId);
        setRemotePeerCount(remotePeerIdsRef.current.size);
      },
      onPeerDisconnected: (peerId) => {
        remotePeerIdsRef.current.delete(peerId);
        remoteStreamsMapRef.current.delete(peerId);
        remotePeerPublicKeySpkiRef.current.delete(peerId);
        remotePeerEcdhPublicKeySpkiRef.current.delete(peerId);
        remotePeerVerifyKeyRef.current.delete(peerId);
        sharedEncryptionKeysRef.current.delete(peerId);
        remotePeerFingerprintRef.current.delete(peerId);
        syncRemoteFingerprintsState();
        for (const [fileId, peerStates] of outgoingTransferPeerStateRef.current.entries()) {
          const state = peerStates.get(peerId);
          if (!state || state.completed || state.rejected) {
            continue;
          }

          state.acknowledged = false;
          state.retryCount = 0;
          state.lastMetaSentAt = 0;
          syncOutgoingTransferUi(fileId);
        }
        setRemotePeerCount(remotePeerIdsRef.current.size);
        setRemoteStreamsState(
          Array.from(remoteStreamsMapRef.current.entries()).map(([id, stream]) => ({
            peerId: id,
            stream
          }))
        );
      },
      onRemoteStream: (peerId, stream) => {
        remoteStreamsMapRef.current.set(peerId, stream);
        setRemoteStreamsState(
          Array.from(remoteStreamsMapRef.current.entries()).map(([id, value]) => ({
            peerId: id,
            stream: value
          }))
        );
      },
      onChatMessage: (peerId, message) => {
        void (async () => {
          const isValidMessage = await verifyIncomingMessage(peerId, message);
          if (!isValidMessage) {
            return;
          }

          const payload = await decryptPayloadFromPeer(peerId, message.payload);
          if (!payload) {
            return;
          }

          if (payload.type === 'text') {
            setChatMessages((current) => [
              ...current,
              {
                id: message.id,
                senderId: message.senderId,
                text: payload.text,
                timestamp: message.timestamp,
                incoming: message.senderId !== identity.peerId,
                readBy: [],
                reactions: []
              }
            ]);

            if (message.senderId !== identity.peerId) {
              void (async () => {
                const receipt = await createSignedMessageForPeer(peerId, {
                  type: 'receipt',
                  messageId: message.id
                });
                await sendChatMessageWithRetry(peerId, receipt);
              })();
            }
            return;
          }

          if (payload.type === 'receipt') {
            setChatMessages((current) =>
              current.map((entry) => {
                if (entry.id !== payload.messageId) {
                  return entry;
                }

                if (entry.readBy.includes(message.senderId)) {
                  return entry;
                }

                return {
                  ...entry,
                  readBy: [...entry.readBy, message.senderId]
                };
              })
            );
            return;
          }

          if (payload.type === 'reaction') {
            setChatMessages((current) =>
              current.map((entry) => {
                if (entry.id !== payload.messageId) {
                  return entry;
                }

                const hasReaction = entry.reactions.some(
                  (reaction) =>
                    reaction.senderId === message.senderId && reaction.emoji === payload.emoji
                );

                if (hasReaction) {
                  return entry;
                }

                return {
                  ...entry,
                  reactions: [
                    ...entry.reactions,
                    {
                      senderId: message.senderId,
                      emoji: payload.emoji
                    }
                  ]
                };
              })
            );
            return;
          }

          if (payload.type === 'file-meta') {
            const existingChunks =
              incomingFileChunksRef.current.get(payload.fileId) ?? new Map<number, string>();
            incomingFileChunksRef.current.set(payload.fileId, existingChunks);

            const existingTransfer = incomingFileMetaRef.current.get(payload.fileId);
            const transfer: FileTransferEntry = {
              fileId: payload.fileId,
              name: payload.name,
              size: payload.size,
              totalChunks: payload.totalChunks,
              receivedChunks: existingChunks.size,
              status: existingTransfer?.status === 'completed' ? 'completed' : 'receiving',
              checksum: payload.checksum,
              peerStates: [],
              ...(existingTransfer?.downloadUrl
                ? {
                    downloadUrl: existingTransfer.downloadUrl
                  }
                : {})
            };

            incomingFileMetaRef.current.set(payload.fileId, transfer);

            setFileTransfers((current) => {
              const withoutExisting = current.filter((entry) => entry.fileId !== payload.fileId);
              return [...withoutExisting, transfer];
            });

            if (transfer.status === 'completed') {
              void (async () => {
                const ack = await createSignedMessageForPeer(peerId, {
                  type: 'file-ack',
                  fileId: payload.fileId,
                  status: 'complete'
                });
                await sendChatMessageWithRetry(peerId, ack);
              })();
              return;
            }

            const missingChunks = buildMissingChunkIndexes(payload.totalChunks, existingChunks);

            void (async () => {
              const ack = await createSignedMessageForPeer(peerId, {
                type: 'file-ack',
                fileId: payload.fileId,
                status: 'accepted',
                missingChunks
              });
              await sendChatMessageWithRetry(peerId, ack);
            })();
            return;
          }

          if (payload.type === 'file-chunk') {
            const chunks = incomingFileChunksRef.current.get(payload.fileId);
            const meta = incomingFileMetaRef.current.get(payload.fileId);
            if (!chunks || !meta) {
              return;
            }

            if (chunks.has(payload.chunkIndex)) {
              return;
            }

            chunks.set(payload.chunkIndex, payload.data);
            const receivedChunks = chunks.size;

            setFileTransfers((current) =>
              current.map((entry) =>
                entry.fileId === payload.fileId
                  ? {
                      ...entry,
                      receivedChunks
                    }
                  : entry
              )
            );

            if (receivedChunks < meta.totalChunks) {
              return;
            }

            void (async () => {
              try {
                const merged = assembleChunkMapToBytes(meta.totalChunks, chunks);
                const mergedBuffer = merged.buffer.slice(
                  merged.byteOffset,
                  merged.byteOffset + merged.byteLength
                ) as ArrayBuffer;

                const checksum = `sha256:${await sha256Hex(mergedBuffer)}`;
                if (checksum !== meta.checksum) {
                  throw new Error('Checksum mismatch.');
                }

                const downloadUrl = URL.createObjectURL(new Blob([mergedBuffer]));
                const completedTransfer: FileTransferEntry = {
                  ...meta,
                  receivedChunks: meta.totalChunks,
                  status: 'completed',
                  downloadUrl
                };

                incomingFileMetaRef.current.set(payload.fileId, completedTransfer);
                setFileTransfers((current) =>
                  current.map((entry) =>
                    entry.fileId === payload.fileId ? completedTransfer : entry
                  )
                );

                const ack = await createSignedMessageForPeer(peerId, {
                  type: 'file-ack',
                  fileId: payload.fileId,
                  status: 'complete'
                });
                await sendChatMessageWithRetry(peerId, ack);
              } catch (error) {
                const reason = error instanceof Error ? error.message : 'Failed to assemble file.';
                setFileTransfers((current) =>
                  current.map((entry) =>
                    entry.fileId === payload.fileId
                      ? {
                          ...entry,
                          status: 'failed',
                          error: reason
                        }
                      : entry
                  )
                );

                const ack = await createSignedMessageForPeer(peerId, {
                  type: 'file-ack',
                  fileId: payload.fileId,
                  status: 'rejected',
                  reason
                });
                await sendChatMessageWithRetry(peerId, ack);
              }
            })();
            return;
          }

          if (payload.type === 'file-ack') {
            const peerAckState = getOrCreatePeerAckState(payload.fileId, peerId);
            peerAckState.lastMetaSentAt = Date.now();

            if (payload.status === 'accepted') {
              peerAckState.acknowledged = true;
              peerAckState.retryCount = 0;
              const transfer = outgoingTransfersRef.current.get(payload.fileId);
              if (transfer) {
                const requestedChunks =
                  payload.missingChunks ??
                  Array.from({ length: transfer.totalChunks }, (_, index) => index);
                const missingChunks = normalizeChunkIndexes(requestedChunks, transfer.totalChunks);
                if (missingChunks.length > 0) {
                  void sendFileChunksToPeer(peerId, transfer, missingChunks);
                }
              }
              syncOutgoingTransferUi(payload.fileId);
            }
            if (payload.status === 'complete') {
              peerAckState.completed = true;
              finalizeOutgoingTransferStatus(payload.fileId);
            }
            if (payload.status === 'rejected') {
              peerAckState.rejected = true;
              if (payload.reason) {
                peerAckState.error = payload.reason;
              }
              if (payload.reason) {
                setLastError(payload.reason);
              }
              finalizeOutgoingTransferStatus(payload.fileId);
            }
          }
        })();
      },
      onError: (error) => {
        setLastError(error.message);
      }
    });

    peerManagerRef.current = manager;
    return () => {
      manager.closeAll();
      peerManagerRef.current = null;
    };
  }, [identity.peerId, transport]);

  useEffect(() => {
    transportRef.current = transport;
    const restored = readRoomIdFromSessionStorage();
    if (restored) {
      setRoomIdState(restored);
    }
    transport.reconnectFromSession();

    return () => {
      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          track.stop();
        }
      }
      for (const transfer of incomingFileMetaRef.current.values()) {
        if (transfer.downloadUrl) {
          URL.revokeObjectURL(transfer.downloadUrl);
        }
      }
      transport.disconnect();
      transportRef.current = null;
    };
  }, [transport]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const manager = peerManagerRef.current;
      if (!manager || remotePeerIdsRef.current.size === 0) {
        statsTrackingStartedAtRef.current = null;
        bitrateByPeerRef.current.clear();
        relayEnableStreakRef.current = 0;
        relayDisableStreakRef.current = 0;
        setPeerConnectionQualities([]);
        setConnectionStats({
          quality: 'good',
          packetLossPercent: 0,
          rttMs: null,
          jitterMs: null,
          relayFallbackRecommended: false
        });
        return;
      }

      if (statsTrackingStartedAtRef.current === null) {
        statsTrackingStartedAtRef.current = Date.now();
      }

      void (async () => {
        let packetsSent = 0;
        let packetsLost = 0;
        const rttSamples: number[] = [];
        const jitterSamples: number[] = [];
        const perPeerAssessments: PeerConnectionQualityEntry[] = [];

        for (const { peerId, connection } of manager.getConnections()) {
          try {
            const stats = await connection.getStats();
            let peerPacketsSent = 0;
            let peerPacketsLost = 0;
            let peerRttMs: number | null = null;
            let peerJitterMs: number | null = null;

            for (const report of stats.values()) {
              if (report.type === 'outbound-rtp') {
                peerPacketsSent += asFiniteNumber(report.packetsSent) ?? 0;
                peerPacketsLost += asFiniteNumber(report.packetsLost) ?? 0;
              }

              if (report.type === 'remote-inbound-rtp') {
                const roundTripTimeSeconds = asFiniteNumber(report.roundTripTime);
                if (roundTripTimeSeconds !== null) {
                  peerRttMs = roundTripTimeSeconds * 1000;
                }

                const jitterSeconds = asFiniteNumber(report.jitter);
                if (jitterSeconds !== null) {
                  peerJitterMs = jitterSeconds * 1000;
                }
              }

              if (report.type === 'candidate-pair') {
                const candidatePair = report as RTCStatsReport[keyof RTCStatsReport] & {
                  currentRoundTripTime?: number;
                  state?: string;
                };
                if (candidatePair.state === 'succeeded' && peerRttMs === null) {
                  const fallbackRttSeconds = asFiniteNumber(candidatePair.currentRoundTripTime);
                  if (fallbackRttSeconds !== null) {
                    peerRttMs = fallbackRttSeconds * 1000;
                  }
                }
              }

              if (report.type === 'inbound-rtp' && peerJitterMs === null) {
                const inboundJitterSeconds = asFiniteNumber(report.jitter);
                if (inboundJitterSeconds !== null) {
                  peerJitterMs = inboundJitterSeconds * 1000;
                }
              }
            }

            packetsSent += peerPacketsSent;
            packetsLost += peerPacketsLost;
            if (peerRttMs !== null) {
              rttSamples.push(peerRttMs);
            }
            if (peerJitterMs !== null) {
              jitterSamples.push(peerJitterMs);
            }

            const assessment = assessConnectionQuality(
              {
                packetsSent: peerPacketsSent,
                packetsLost: peerPacketsLost,
                rttMs: peerRttMs ?? 0,
                jitterMs: peerJitterMs ?? 0
              },
              Date.now() - (statsTrackingStartedAtRef.current ?? Date.now())
            );
            perPeerAssessments.push({
              peerId,
              quality: assessment.quality,
              packetLossPercent: assessment.packetLossPercent,
              rttMs: peerRttMs,
              jitterMs: peerJitterMs
            });

            const targetKbps =
              assessment.quality === 'poor' ? 350 : assessment.quality === 'fair' ? 800 : 1500;
            if (bitrateByPeerRef.current.get(peerId) !== targetKbps) {
              for (const sender of connection.getSenders()) {
                if (sender.track?.kind !== 'video') {
                  continue;
                }

                try {
                  await setVideoBitrate(sender, targetKbps);
                } catch {
                  // Ignore sender-level errors and continue with other peers.
                }
              }
              bitrateByPeerRef.current.set(peerId, targetKbps);
            }
          } catch {
            // Ignore peer stats failures; other peers can still produce aggregate metrics.
          }
        }

        const rttMs =
          rttSamples.length > 0
            ? rttSamples.reduce((sum, value) => sum + value, 0) / rttSamples.length
            : null;
        const jitterMs =
          jitterSamples.length > 0
            ? jitterSamples.reduce((sum, value) => sum + value, 0) / jitterSamples.length
            : null;
        const aggregateAssessment = assessConnectionQuality(
          {
            packetsSent,
            packetsLost,
            rttMs: rttMs ?? 0,
            jitterMs: jitterMs ?? 0
          },
          Date.now() - (statsTrackingStartedAtRef.current ?? Date.now())
        );

        if (aggregateAssessment.quality !== lastQualityRef.current) {
          if (aggregateAssessment.quality === 'poor') {
            setNetworkNotice(
              'Connection quality is poor. Lowering video bitrate and preparing relay fallback.'
            );
          } else if (aggregateAssessment.quality === 'fair') {
            setNetworkNotice(
              'Connection quality is fair. Video bitrate reduced to keep call stable.'
            );
          } else {
            setNetworkNotice('Connection quality recovered to good.');
          }
          lastQualityRef.current = aggregateAssessment.quality;
        }

        setConnectionStats({
          quality: aggregateAssessment.quality,
          packetLossPercent: aggregateAssessment.packetLossPercent,
          rttMs,
          jitterMs,
          relayFallbackRecommended: aggregateAssessment.shouldForceRelay
        });
        setPeerConnectionQualities(
          perPeerAssessments.sort((left, right) => left.peerId.localeCompare(right.peerId))
        );
      })();
    }, 2000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return {
    status,
    roomId,
    setRoomId,
    remotePeerCount,
    localStream: localStreamState,
    remoteStreams: remoteStreamsState,
    isLocalMediaReady,
    isMuted,
    isCameraOff,
    isScreenSharing,
    connectionQuality: connectionStats.quality,
    packetLossPercent: connectionStats.packetLossPercent,
    rttMs: connectionStats.rttMs,
    jitterMs: connectionStats.jitterMs,
    relayFallbackRecommended: connectionStats.relayFallbackRecommended,
    relayModeEnabled,
    networkNotice,
    peerConnectionQualities,
    preferredDevices,
    setPreferredDevices,
    chatMessages,
    fileTransfers,
    localFingerprint,
    remoteFingerprints,
    lastError,
    connect: () => {
      void (async () => {
        const normalizedRoomId = roomId.trim();
        if (!normalizedRoomId) {
          setLastError('Room id is required.');
          return;
        }

        try {
          if (!isSigningReady || !peerPublicKey) {
            throw new Error('Signing identity is not ready yet. Please try again in a moment.');
          }

          if (!localStreamRef.current) {
            if (!navigator.mediaDevices?.getUserMedia) {
              throw new Error('getUserMedia is not available in this browser.');
            }

            const mediaStream = await navigator.mediaDevices.getUserMedia({
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

            localStreamRef.current = mediaStream;
            cameraStreamRef.current = mediaStream;
            peerManagerRef.current?.setLocalStream(mediaStream);

            setLocalStreamState(mediaStream);
            setIsLocalMediaReady(true);
            setIsMuted(false);
            setIsCameraOff(false);
          }

          setLastError(null);
          setRoomIdState(normalizedRoomId);
          writeRoomIdToSessionStorage(normalizedRoomId);
          transportRef.current?.connect(normalizedRoomId);
        } catch (error) {
          setLastError(error instanceof Error ? error.message : 'Failed to start local media.');
        }
      })();
    },
    disconnect: () => {
      peerManagerRef.current?.closeAll();
      remotePeerIdsRef.current.clear();
      remoteStreamsMapRef.current.clear();
      remotePeerPublicKeySpkiRef.current.clear();
      remotePeerVerifyKeyRef.current.clear();
      remotePeerFingerprintRef.current.clear();
      syncRemoteFingerprintsState();
      incomingFileMetaRef.current.clear();
      incomingFileChunksRef.current.clear();
      outgoingTransfersRef.current.clear();
      outgoingTransferPeerStateRef.current.clear();
      bitrateByPeerRef.current.clear();
      statsTrackingStartedAtRef.current = null;
      lastQualityRef.current = 'good';
      relayEnableStreakRef.current = 0;
      relayDisableStreakRef.current = 0;
      relayToggleInFlightRef.current = false;
      lastRelayToggleAtRef.current = 0;
      setRelayModeEnabled(false);
      setNetworkNotice(null);
      setPeerConnectionQualities([]);
      setConnectionStats({
        quality: 'good',
        packetLossPercent: 0,
        rttMs: null,
        jitterMs: null,
        relayFallbackRecommended: false
      });
      setRemoteStreamsState([]);
      setRemotePeerCount(0);
      setFileTransfers([]);
      setRoomIdState('');
      writeRoomIdToSessionStorage('');
      transportRef.current?.disconnect();
    },
    toggleMute: () => {
      const stream = localStreamRef.current;
      if (!stream) {
        return;
      }

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        return;
      }

      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    },
    toggleCamera: () => {
      const stream = localStreamRef.current;
      if (!stream) {
        return;
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) {
        return;
      }

      videoTrack.enabled = !videoTrack.enabled;
      setIsCameraOff(!videoTrack.enabled);
    },
    toggleScreenShare: async () => {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        setLastError('Screen sharing is not available in this browser.');
        return;
      }

      const manager = peerManagerRef.current;
      const activeStream = localStreamRef.current;
      if (!manager || !activeStream) {
        return;
      }

      if (!isScreenSharing) {
        try {
          const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              frameRate: 30
            }
          });

          const screenTrack = displayStream.getVideoTracks()[0];
          if (!screenTrack) {
            throw new Error('No screen track available from getDisplayMedia.');
          }

          screenTrackRef.current = screenTrack;
          screenTrack.onended = () => {
            void (async () => {
              if (!screenTrackRef.current) {
                return;
              }

              const cameraTrack = cameraStreamRef.current?.getVideoTracks()[0];
              const currentAudio = localStreamRef.current?.getAudioTracks()[0] ?? null;
              if (!cameraTrack) {
                return;
              }

              const restoredStream = new MediaStream(
                [currentAudio, cameraTrack].filter((track): track is MediaStreamTrack =>
                  Boolean(track)
                )
              );

              await manager.replaceTrack('video', cameraTrack);
              localStreamRef.current = restoredStream;
              setLocalStreamState(restoredStream);
              setIsScreenSharing(false);
              screenTrackRef.current = null;
            })();
          };

          await manager.replaceTrack('video', screenTrack);

          const currentAudio = activeStream.getAudioTracks()[0] ?? null;
          const screenStream = new MediaStream(
            [currentAudio, screenTrack].filter((track): track is MediaStreamTrack => Boolean(track))
          );

          localStreamRef.current = screenStream;
          setLocalStreamState(screenStream);
          setIsScreenSharing(true);
        } catch (error) {
          setLastError(error instanceof Error ? error.message : 'Failed to start screen sharing.');
        }

        return;
      }

      const cameraTrack = cameraStreamRef.current?.getVideoTracks()[0];
      if (!cameraTrack) {
        setLastError('Camera track is unavailable.');
        return;
      }

      await manager.replaceTrack('video', cameraTrack);

      const currentAudio = activeStream.getAudioTracks()[0] ?? null;
      const restoredStream = new MediaStream(
        [currentAudio, cameraTrack].filter((track): track is MediaStreamTrack => Boolean(track))
      );

      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
      localStreamRef.current = restoredStream;
      setLocalStreamState(restoredStream);
      setIsScreenSharing(false);
    },
    sendChatText: (text: string) => {
      const trimmedText = text.trim();
      if (!trimmedText) {
        return;
      }
      if (trimmedText.length > MAX_CHAT_TEXT_LENGTH) {
        setLastError(`Message is too long. Maximum length is ${MAX_CHAT_TEXT_LENGTH} characters.`);
        return;
      }

      void (async () => {
        const manager = peerManagerRef.current;
        const messageId = crypto.randomUUID();
        const timestamp = Date.now();
        const peers = manager?.getConnections().map((entry) => entry.peerId) ?? [];
        let didSendToAnyPeer = peers.length === 0;
        for (const peerId of peers) {
          const message = await createSignedMessageForPeer(
            peerId,
            {
              type: 'text',
              text: trimmedText
            },
            { id: messageId, timestamp }
          );
          const sent = await sendChatMessageWithRetry(peerId, message);
          if (sent) {
            didSendToAnyPeer = true;
            continue;
          }

          setLastError(`Chat channel is not ready for peer ${peerId.slice(0, 8)}.`);
        }

        if (!didSendToAnyPeer && peers.length > 0) {
          setLastError(
            'Chat channel is still initializing. Message will be retried automatically.'
          );
        }

        setChatMessages((current) => [
          ...current,
          {
            id: messageId,
            senderId: identity.peerId,
            text: trimmedText,
            timestamp,
            incoming: false,
            readBy: [],
            reactions: []
          }
        ]);
      })();
    },
    sendReaction: (messageId: string, emoji: string) => {
      const normalizedEmoji = emoji.trim();
      if (!normalizedEmoji) {
        return;
      }
      if (normalizedEmoji.length > MAX_REACTION_LENGTH) {
        setLastError(`Reaction is too long. Maximum length is ${MAX_REACTION_LENGTH} characters.`);
        return;
      }

      void (async () => {
        const manager = peerManagerRef.current;
        const reactionId = crypto.randomUUID();
        const timestamp = Date.now();
        const peers = manager?.getConnections().map((entry) => entry.peerId) ?? [];
        let didSendToAnyPeer = peers.length === 0;
        for (const peerId of peers) {
          const reactionMessage = await createSignedMessageForPeer(
            peerId,
            {
              type: 'reaction',
              messageId,
              emoji: normalizedEmoji
            },
            { id: reactionId, timestamp }
          );
          const sent = await sendChatMessageWithRetry(peerId, reactionMessage);
          if (sent) {
            didSendToAnyPeer = true;
          } else {
            setLastError(`Chat channel is not ready for peer ${peerId.slice(0, 8)}.`);
          }
        }

        if (!didSendToAnyPeer && peers.length > 0) {
          setLastError('Chat channel is still initializing. Reaction delivery will retry shortly.');
        }

        setChatMessages((current) =>
          current.map((entry) => {
            if (entry.id !== messageId) {
              return entry;
            }

            const hasReaction = entry.reactions.some(
              (reaction) =>
                reaction.senderId === identity.peerId && reaction.emoji === normalizedEmoji
            );

            if (hasReaction) {
              return entry;
            }

            return {
              ...entry,
              reactions: [
                ...entry.reactions,
                {
                  senderId: identity.peerId,
                  emoji: normalizedEmoji
                }
              ]
            };
          })
        );
      })();
    },
    sendFile: async (file: File) => {
      if (file.size <= 0) {
        setLastError('Cannot send empty file.');
        return;
      }

      const manager = peerManagerRef.current;
      if (!manager) {
        setLastError('Peer manager is not initialized yet.');
        return;
      }

      try {
        const fileBuffer = await file.arrayBuffer();
        const checksum = `sha256:${await sha256Hex(fileBuffer)}`;
        const fileId = crypto.randomUUID();
        const totalChunks = computeTotalChunks(file.size, DEFAULT_FILE_CHUNK_SIZE_BYTES);

        const transfer: FileTransferEntry = {
          fileId,
          name: file.name,
          size: file.size,
          totalChunks,
          receivedChunks: 0,
          status: 'sending',
          checksum,
          peerStates: []
        };

        outgoingTransfersRef.current.set(fileId, {
          file,
          fileBuffer,
          fileId,
          name: file.name,
          size: file.size,
          totalChunks,
          checksum
        });
        outgoingTransferPeerStateRef.current.set(fileId, new Map());

        setFileTransfers((current) => {
          const withoutExisting = current.filter((entry) => entry.fileId !== fileId);
          return [...withoutExisting, transfer];
        });

        const transferRef = outgoingTransfersRef.current.get(fileId);
        if (!transferRef) {
          throw new Error('Outgoing transfer entry is missing.');
        }

        if (remotePeerIdsRef.current.size === 0) {
          setFileTransfers((current) =>
            current.map((entry) =>
              entry.fileId === fileId
                ? {
                    ...entry,
                    status: 'failed',
                    error: 'No peers connected for file transfer.'
                  }
                : entry
            )
          );
          outgoingTransfersRef.current.delete(fileId);
          outgoingTransferPeerStateRef.current.delete(fileId);
          return;
        }

        for (const peerId of remotePeerIdsRef.current) {
          const peerState = getOrCreatePeerAckState(fileId, peerId);
          peerState.acknowledged = false;
          peerState.completed = false;
          peerState.rejected = false;
          peerState.retryCount = 0;
          peerState.lastMetaSentAt = 0;
          delete peerState.error;
          peerState.sentChunkIndexes.clear();
          await sendFileMetaToPeer(peerId, transferRef);
        }
        syncOutgoingTransferUi(fileId);
      } catch (error) {
        setLastError(error instanceof Error ? error.message : 'Failed to send file.');
      }
    }
  };
}
