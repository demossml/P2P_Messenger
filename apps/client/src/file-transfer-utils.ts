import { base64ToBytes } from '@p2p/crypto';

export const DEFAULT_FILE_CHUNK_SIZE_BYTES = 16 * 1024;

export function computeTotalChunks(
  fileSizeBytes: number,
  chunkSizeBytes = DEFAULT_FILE_CHUNK_SIZE_BYTES
): number {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    throw new Error('File size must be a positive number.');
  }

  if (!Number.isFinite(chunkSizeBytes) || chunkSizeBytes <= 0) {
    throw new Error('Chunk size must be a positive number.');
  }

  return Math.ceil(fileSizeBytes / chunkSizeBytes);
}

export function buildMissingChunkIndexes(
  totalChunks: number,
  receivedChunks: Pick<Map<number, unknown>, 'has'>
): number[] {
  if (!Number.isInteger(totalChunks) || totalChunks <= 0) {
    throw new Error('totalChunks must be a positive integer.');
  }

  const missing: number[] = [];
  for (let index = 0; index < totalChunks; index += 1) {
    if (!receivedChunks.has(index)) {
      missing.push(index);
    }
  }

  return missing;
}

export function assembleChunkMapToBytes(
  totalChunks: number,
  chunks: Pick<Map<number, string>, 'get'>
): Uint8Array {
  if (!Number.isInteger(totalChunks) || totalChunks <= 0) {
    throw new Error('totalChunks must be a positive integer.');
  }

  const orderedChunks: Uint8Array[] = [];
  let totalLength = 0;

  for (let index = 0; index < totalChunks; index += 1) {
    const encodedChunk = chunks.get(index);
    if (!encodedChunk) {
      throw new Error(`Missing chunk index ${index}.`);
    }

    const decodedChunk = base64ToBytes(encodedChunk);
    orderedChunks.push(decodedChunk);
    totalLength += decodedChunk.length;
  }

  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const decodedChunk of orderedChunks) {
    merged.set(decodedChunk, offset);
    offset += decodedChunk.length;
  }

  return merged;
}
