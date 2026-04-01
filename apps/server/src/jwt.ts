import { importSPKI, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

const RS256 = 'RS256';

function normalizePublicKey(value: string): string {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

export async function verifyRoomToken(token: string, publicKeyPem: string): Promise<void> {
  const normalizedKey = normalizePublicKey(publicKeyPem);
  const keyLike = await importSPKI(normalizedKey, RS256);
  await jwtVerify(token, keyLike, { algorithms: [RS256] });
}

export async function verifyJwt(token: string, publicKeyPem: string): Promise<JWTPayload> {
  const normalizedKey = normalizePublicKey(publicKeyPem);
  const keyLike = await importSPKI(normalizedKey, RS256);
  const result = await jwtVerify(token, keyLike, { algorithms: [RS256] });
  return result.payload;
}
