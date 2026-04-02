import { describe, expect, it } from 'vitest';
import {
  decryptAesGcm,
  deriveSharedAes256GcmKey,
  deserializeSigningKeyPair,
  encryptAesGcm,
  exportEcdhPrivateKeyBase64,
  exportEcdhPublicKeyBase64,
  generateEcdhKeyPair,
  generateSigningKeyPair,
  importEcdhPrivateKeyBase64,
  importEcdhPublicKeyBase64,
  importSigningPublicKeyBase64,
  serializeSigningKeyPair,
  signBytes,
  verifyBytes
} from './index.js';

describe('@p2p/crypto', () => {
  it('signs and verifies payload bytes', async () => {
    const signingPair = await generateSigningKeyPair(true);
    const message = new TextEncoder().encode('p2p-signed-message');
    const signature = await signBytes(signingPair.privateKey, message);

    const isValid = await verifyBytes(signingPair.publicKey, message, signature);
    expect(isValid).toBe(true);
  });

  it('serializes and deserializes signing key pair', async () => {
    const signingPair = await generateSigningKeyPair(true);
    const serialized = await serializeSigningKeyPair(signingPair);
    const restored = await deserializeSigningKeyPair(serialized);

    const message = new TextEncoder().encode('serialize-roundtrip');
    const signature = await signBytes(restored.privateKey, message);
    const importedPublic = await importSigningPublicKeyBase64(serialized.publicKeySpkiBase64);
    const isValid = await verifyBytes(importedPublic, message, signature);
    expect(isValid).toBe(true);
  });

  it('derives shared AES key and decrypts peer encrypted payload', async () => {
    const aliceEcdh = await generateEcdhKeyPair(true);
    const bobEcdh = await generateEcdhKeyPair(true);
    const aliceShared = await deriveSharedAes256GcmKey(aliceEcdh.privateKey, bobEcdh.publicKey);
    const bobShared = await deriveSharedAes256GcmKey(bobEcdh.privateKey, aliceEcdh.publicKey);

    const encrypted = await encryptAesGcm(aliceShared, 'hello-secure-world');
    const decrypted = await decryptAesGcm(bobShared, encrypted, 'string');
    expect(decrypted).toBe('hello-secure-world');
  });

  it('exports and imports ECDH key material', async () => {
    const local = await generateEcdhKeyPair(true);
    const peer = await generateEcdhKeyPair(true);

    const localPrivateB64 = await exportEcdhPrivateKeyBase64(local.privateKey);
    const peerPublicB64 = await exportEcdhPublicKeyBase64(peer.publicKey);

    const restoredLocalPrivate = await importEcdhPrivateKeyBase64(localPrivateB64);
    const restoredPeerPublic = await importEcdhPublicKeyBase64(peerPublicB64);

    const restoredShared = await deriveSharedAes256GcmKey(restoredLocalPrivate, restoredPeerPublic);
    const peerShared = await deriveSharedAes256GcmKey(peer.privateKey, local.publicKey);

    const encrypted = await encryptAesGcm(restoredShared, 'ecdh-import-export');
    const decrypted = await decryptAesGcm(peerShared, encrypted, 'string');
    expect(decrypted).toBe('ecdh-import-export');
  });
});

