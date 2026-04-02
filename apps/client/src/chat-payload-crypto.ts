import { decryptAesGcm, encryptAesGcm, type AesGcmCiphertext, bytesToBase64, base64ToBytes } from '@p2p/crypto';
import { chatMessageSchema, type ChatMessage } from '@p2p/shared';

export type PeerPublicKeyBundle = {
  signingPublicKeySpkiBase64: string;
  ecdhPublicKeySpkiBase64?: string;
};

export const PEER_PUBLIC_KEY_BUNDLE_PREFIX = 'p2p-key-bundle-v1:';

export function encodePeerPublicKeyBundle(bundle: PeerPublicKeyBundle): string {
  return `${PEER_PUBLIC_KEY_BUNDLE_PREFIX}${bytesToBase64(
    new TextEncoder().encode(JSON.stringify(bundle))
  )}`;
}

export function decodePeerPublicKeyBundle(rawValue: string): PeerPublicKeyBundle {
  if (!rawValue.startsWith(PEER_PUBLIC_KEY_BUNDLE_PREFIX)) {
    return {
      signingPublicKeySpkiBase64: rawValue
    };
  }

  const encoded = rawValue.slice(PEER_PUBLIC_KEY_BUNDLE_PREFIX.length);
  const decodedJson = new TextDecoder().decode(base64ToBytes(encoded));
  const parsed = JSON.parse(decodedJson) as Partial<PeerPublicKeyBundle>;

  if (
    typeof parsed.signingPublicKeySpkiBase64 !== 'string' ||
    parsed.signingPublicKeySpkiBase64.length === 0
  ) {
    throw new Error('Peer key bundle is missing signing key.');
  }

  if (
    parsed.ecdhPublicKeySpkiBase64 !== undefined &&
    (typeof parsed.ecdhPublicKeySpkiBase64 !== 'string' || parsed.ecdhPublicKeySpkiBase64.length === 0)
  ) {
    throw new Error('Peer key bundle has invalid ecdh key.');
  }

  return {
    signingPublicKeySpkiBase64: parsed.signingPublicKeySpkiBase64,
    ...(parsed.ecdhPublicKeySpkiBase64
      ? { ecdhPublicKeySpkiBase64: parsed.ecdhPublicKeySpkiBase64 }
      : {})
  };
}

export async function encryptPayloadWithSharedKey(
  payload: ChatMessage['payload'],
  sharedKey: CryptoKey | null
): Promise<ChatMessage['payload']> {
  if (payload.type === 'encrypted' || !sharedKey) {
    return payload;
  }

  const encrypted = await encryptAesGcm(sharedKey, JSON.stringify(payload));
  return {
    type: 'encrypted',
    ivBase64: encrypted.ivBase64,
    ciphertextBase64: encrypted.ciphertextBase64
  };
}

export async function decryptPayloadWithSharedKey(
  payload: ChatMessage['payload'],
  sharedKey: CryptoKey | null
): Promise<{ payload: ChatMessage['payload'] | null; error: string | null }> {
  if (payload.type !== 'encrypted') {
    return { payload, error: null };
  }

  if (!sharedKey) {
    return { payload: null, error: 'Missing encryption session key.' };
  }

  try {
    const plaintext = await decryptAesGcm(sharedKey, payload as AesGcmCiphertext, 'string');
    if (typeof plaintext !== 'string') {
      return { payload: null, error: 'Encrypted payload plaintext type is invalid.' };
    }

    const parsed = JSON.parse(plaintext) as unknown;
    const envelope = chatMessageSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000000',
      timestamp: 1,
      senderId: '11111111-1111-4111-8111-111111111111',
      signature: 'placeholder',
      payload: parsed
    });
    if (!envelope.success || envelope.data.payload.type === 'encrypted') {
      return { payload: null, error: 'Encrypted payload schema is invalid.' };
    }

    return { payload: envelope.data.payload, error: null };
  } catch (error) {
    return {
      payload: null,
      error: error instanceof Error ? error.message : 'Encrypted payload decryption failed.'
    };
  }
}
