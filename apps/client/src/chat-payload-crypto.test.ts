import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptAesGcm, encryptAesGcm } from '@p2p/crypto';

vi.mock('@p2p/crypto', async () => {
  const actual = await vi.importActual<typeof import('@p2p/crypto')>('@p2p/crypto');
  return {
    ...actual,
    encryptAesGcm: vi.fn(async () => ({
      ivBase64: 'mock-iv',
      ciphertextBase64: 'mock-cipher'
    })),
    decryptAesGcm: vi.fn(async () => JSON.stringify({
      type: 'file-chunk',
      fileId: '11111111-1111-4111-8111-111111111111',
      chunkIndex: 0,
      data: 'Y2h1bms='
    }))
  };
});
import {
  decodePeerPublicKeyBundle,
  decryptPayloadWithSharedKey,
  encodePeerPublicKeyBundle,
  encryptPayloadWithSharedKey
} from './chat-payload-crypto.js';

describe('chat-payload-crypto', () => {
  const mockedEncryptAesGcm = vi.mocked(encryptAesGcm);
  const mockedDecryptAesGcm = vi.mocked(decryptAesGcm);

  beforeEach(() => {
    mockedEncryptAesGcm.mockReset();
    mockedDecryptAesGcm.mockReset();
    mockedEncryptAesGcm.mockResolvedValue({
      ivBase64: 'mock-iv',
      ciphertextBase64: 'mock-cipher'
    });
    mockedDecryptAesGcm.mockResolvedValue(
      JSON.stringify({
        type: 'file-chunk',
        fileId: '11111111-1111-4111-8111-111111111111',
        chunkIndex: 0,
        data: 'Y2h1bms='
      })
    );
  });

  it('throws on malformed key bundle content', () => {
    expect(() =>
      decodePeerPublicKeyBundle('p2p-key-bundle-v1:bm90LWpzb24=')
    ).toThrow();
  });

  it('encodes and decodes peer public key bundle', () => {
    const encoded = encodePeerPublicKeyBundle({
      signingPublicKeySpkiBase64: 'signing-key',
      ecdhPublicKeySpkiBase64: 'ecdh-key'
    });

    const decoded = decodePeerPublicKeyBundle(encoded);
    expect(decoded).toEqual({
      signingPublicKeySpkiBase64: 'signing-key',
      ecdhPublicKeySpkiBase64: 'ecdh-key'
    });
  });

  it('supports legacy non-bundle peer key values', () => {
    const decoded = decodePeerPublicKeyBundle('legacy-signing-only-key');
    expect(decoded).toEqual({
      signingPublicKeySpkiBase64: 'legacy-signing-only-key'
    });
  });

  it('encrypts and decrypts file-chunk payload when shared key exists', async () => {
    const key = {} as CryptoKey;
    const payload = {
      type: 'file-chunk' as const,
      fileId: '11111111-1111-4111-8111-111111111111',
      chunkIndex: 0,
      data: 'Y2h1bms='
    };

    const encrypted = await encryptPayloadWithSharedKey(payload, key);
    expect(encrypted).toEqual({
      type: 'encrypted',
      ivBase64: 'mock-iv',
      ciphertextBase64: 'mock-cipher'
    });

    const decrypted = await decryptPayloadWithSharedKey(encrypted, key);
    expect(decrypted.error).toBeNull();
    expect(decrypted.payload).toEqual(payload);
  });

  it('falls back to plaintext when shared key is missing', async () => {
    const payload = {
      type: 'text' as const,
      text: 'hello'
    };

    const encrypted = await encryptPayloadWithSharedKey(payload, null);
    expect(encrypted).toEqual(payload);
  });

  it('keeps already encrypted payload untouched', async () => {
    const payload = {
      type: 'encrypted' as const,
      ivBase64: 'iv',
      ciphertextBase64: 'cipher'
    };
    const result = await encryptPayloadWithSharedKey(payload, {} as CryptoKey);
    expect(result).toEqual(payload);
    expect(mockedEncryptAesGcm).not.toHaveBeenCalled();
  });

  it('returns explicit error when encrypted payload arrives without shared key', async () => {
    const decrypted = await decryptPayloadWithSharedKey(
      {
        type: 'encrypted',
        ivBase64: 'iv',
        ciphertextBase64: 'cipher'
      },
      null
    );
    expect(decrypted.payload).toBeNull();
    expect(decrypted.error).toBe('Missing encryption session key.');
  });

  it('returns schema error for invalid decrypted payload', async () => {
    mockedDecryptAesGcm.mockResolvedValue(
      JSON.stringify({
        type: 'file-chunk',
        fileId: '11111111-1111-4111-8111-111111111111',
        chunkIndex: -1,
        data: ''
      })
    );

    const decrypted = await decryptPayloadWithSharedKey(
      {
        type: 'encrypted',
        ivBase64: 'iv',
        ciphertextBase64: 'cipher'
      },
      {} as CryptoKey
    );
    expect(decrypted.payload).toBeNull();
    expect(decrypted.error).toBe('Encrypted payload schema is invalid.');
  });

  it('returns decrypt error for corrupted ciphertext', async () => {
    mockedDecryptAesGcm.mockRejectedValue(new Error('OperationError'));

    const decrypted = await decryptPayloadWithSharedKey(
      {
        type: 'encrypted',
        ivBase64: 'iv',
        ciphertextBase64: 'broken'
      },
      {} as CryptoKey
    );

    expect(decrypted.payload).toBeNull();
    expect(decrypted.error).toContain('OperationError');
  });

  it('returns plaintext type error when decrypt helper returns bytes', async () => {
    mockedDecryptAesGcm.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const decrypted = await decryptPayloadWithSharedKey(
      {
        type: 'encrypted',
        ivBase64: 'iv',
        ciphertextBase64: 'cipher'
      },
      {} as CryptoKey
    );

    expect(decrypted.payload).toBeNull();
    expect(decrypted.error).toBe('Encrypted payload plaintext type is invalid.');
  });
});
