const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export type SerializableSigningKeyPair = {
  publicKeySpkiBase64: string;
  privateKeyPkcs8Base64: string;
};

export type AesGcmCiphertext = {
  ivBase64: string;
  ciphertextBase64: string;
};

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64ToBytes(base64Value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64Value, 'base64'));
  }

  const binary = atob(base64Value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function sha256Hex(input: string | Uint8Array | ArrayBuffer): Promise<string> {
  const bytes =
    typeof input === 'string' ? textEncoder.encode(input) : input instanceof Uint8Array ? input : new Uint8Array(input);
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
  const hashBytes = new Uint8Array(digest);
  return Array.from(hashBytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function generateSigningKeyPair(
  extractable = true
): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    extractable,
    ['sign', 'verify']
  );
}

export async function exportSigningPublicKeyBase64(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  return bytesToBase64(new Uint8Array(spki));
}

export async function exportSigningPrivateKeyBase64(privateKey: CryptoKey): Promise<string> {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
  return bytesToBase64(new Uint8Array(pkcs8));
}

export async function importSigningPublicKeyBase64(publicKeySpkiBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    toArrayBuffer(base64ToBytes(publicKeySpkiBase64)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
}

export async function importSigningPrivateKeyBase64(privateKeyPkcs8Base64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(base64ToBytes(privateKeyPkcs8Base64)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign']
  );
}

export async function serializeSigningKeyPair(
  keyPair: CryptoKeyPair
): Promise<SerializableSigningKeyPair> {
  return {
    publicKeySpkiBase64: await exportSigningPublicKeyBase64(keyPair.publicKey),
    privateKeyPkcs8Base64: await exportSigningPrivateKeyBase64(keyPair.privateKey)
  };
}

export async function deserializeSigningKeyPair(
  serialized: SerializableSigningKeyPair
): Promise<CryptoKeyPair> {
  return {
    publicKey: await importSigningPublicKeyBase64(serialized.publicKeySpkiBase64),
    privateKey: await importSigningPrivateKeyBase64(serialized.privateKeyPkcs8Base64)
  };
}

export async function signBytes(privateKey: CryptoKey, payload: Uint8Array): Promise<string> {
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    toArrayBuffer(payload)
  );
  return bytesToBase64(new Uint8Array(signature));
}

export async function verifyBytes(
  publicKey: CryptoKey,
  payload: Uint8Array,
  signatureBase64: string
): Promise<boolean> {
  const signatureBytes = base64ToBytes(signatureBase64);
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    toArrayBuffer(signatureBytes),
    toArrayBuffer(payload)
  );
}

export async function generateEcdhKeyPair(
  extractable = false
): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    extractable,
    ['deriveKey']
  );
}

export async function exportEcdhPublicKeyBase64(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  return bytesToBase64(new Uint8Array(spki));
}

export async function importEcdhPublicKeyBase64(publicKeySpkiBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    toArrayBuffer(base64ToBytes(publicKeySpkiBase64)),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

export async function exportEcdhPrivateKeyBase64(privateKey: CryptoKey): Promise<string> {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
  return bytesToBase64(new Uint8Array(pkcs8));
}

export async function importEcdhPrivateKeyBase64(privateKeyPkcs8Base64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(base64ToBytes(privateKeyPkcs8Base64)),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey']
  );
}

export async function deriveSharedAes256GcmKey(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptAesGcm(
  key: CryptoKey,
  plaintext: string | Uint8Array
): Promise<AesGcmCiphertext> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payloadBytes = typeof plaintext === 'string' ? textEncoder.encode(plaintext) : plaintext;
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(payloadBytes)
  );

  return {
    ivBase64: bytesToBase64(iv),
    ciphertextBase64: bytesToBase64(new Uint8Array(ciphertext))
  };
}

export async function decryptAesGcm(
  key: CryptoKey,
  encrypted: AesGcmCiphertext,
  output: 'string' | 'bytes' = 'string'
): Promise<string | Uint8Array> {
  const iv = base64ToBytes(encrypted.ivBase64);
  const ciphertext = base64ToBytes(encrypted.ciphertextBase64);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ciphertext)
  );
  const bytes = new Uint8Array(decrypted);
  if (output === 'bytes') {
    return bytes;
  }

  return textDecoder.decode(bytes);
}

export async function publicKeyFingerprint(publicKeySpkiBase64: string): Promise<string> {
  return sha256Hex(base64ToBytes(publicKeySpkiBase64));
}
