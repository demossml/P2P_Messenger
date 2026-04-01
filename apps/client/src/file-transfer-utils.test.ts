import { bytesToBase64 } from '@p2p/crypto';
import { describe, expect, it } from 'vitest';
import {
  assembleChunkMapToBytes,
  buildMissingChunkIndexes,
  computeTotalChunks,
  DEFAULT_FILE_CHUNK_SIZE_BYTES
} from './file-transfer-utils.js';

describe('file-transfer-utils', () => {
  it('computes chunk counts for a positive file size', () => {
    expect(computeTotalChunks(1)).toBe(1);
    expect(computeTotalChunks(DEFAULT_FILE_CHUNK_SIZE_BYTES)).toBe(1);
    expect(computeTotalChunks(DEFAULT_FILE_CHUNK_SIZE_BYTES + 1)).toBe(2);
  });

  it('builds missing chunk indexes from received map state', () => {
    const received = new Map<number, string>([
      [0, 'a'],
      [2, 'b']
    ]);

    expect(buildMissingChunkIndexes(4, received)).toEqual([1, 3]);
  });

  it('assembles base64 chunks back to original payload (happy path)', () => {
    const source = new Uint8Array(DEFAULT_FILE_CHUNK_SIZE_BYTES * 2 + 777);
    for (let index = 0; index < source.length; index += 1) {
      source[index] = index % 251;
    }

    const chunkMap = new Map<number, string>();
    const totalChunks = computeTotalChunks(source.length);

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      const start = chunkIndex * DEFAULT_FILE_CHUNK_SIZE_BYTES;
      const end = Math.min(start + DEFAULT_FILE_CHUNK_SIZE_BYTES, source.length);
      chunkMap.set(chunkIndex, bytesToBase64(source.slice(start, end)));
    }

    const assembled = assembleChunkMapToBytes(totalChunks, chunkMap);
    expect(assembled).toEqual(source);
  });

  it('throws when assembling and a chunk is missing', () => {
    const chunkMap = new Map<number, string>([[0, bytesToBase64(new Uint8Array([1, 2, 3]))]]);

    expect(() => assembleChunkMapToBytes(2, chunkMap)).toThrow('Missing chunk index 1.');
  });
});
