import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readRoomIdFromSessionStorage,
  ROOM_ID_KEY,
  writeRoomIdToSessionStorage
} from './room-storage.js';

describe('room-storage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('reads empty value when room id is missing', () => {
    expect(readRoomIdFromSessionStorage()).toBe('');
  });

  it('writes trimmed room id value', () => {
    writeRoomIdToSessionStorage('  room-abc  ');
    expect(sessionStorage.getItem(ROOM_ID_KEY)).toBe('room-abc');
    expect(readRoomIdFromSessionStorage()).toBe('room-abc');
  });

  it('clears room id when value is empty after trim', () => {
    sessionStorage.setItem(ROOM_ID_KEY, 'room-will-be-cleared');
    writeRoomIdToSessionStorage('   ');
    expect(sessionStorage.getItem(ROOM_ID_KEY)).toBeNull();
  });

  it('does not throw when sessionStorage APIs fail', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('read failed');
    });
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('write failed');
    });
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('remove failed');
    });

    expect(readRoomIdFromSessionStorage()).toBe('');
    expect(() => writeRoomIdToSessionStorage('room-x')).not.toThrow();
    expect(() => writeRoomIdToSessionStorage('')).not.toThrow();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    removeItemSpy.mockRestore();
  });
});
