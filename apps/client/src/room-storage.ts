export const ROOM_ID_KEY = 'p2p.roomId';

export function readRoomIdFromSessionStorage(): string {
  try {
    return sessionStorage.getItem(ROOM_ID_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeRoomIdToSessionStorage(value: string): void {
  const normalized = value.trim();

  try {
    if (normalized) {
      sessionStorage.setItem(ROOM_ID_KEY, normalized);
      return;
    }
    sessionStorage.removeItem(ROOM_ID_KEY);
  } catch {
    // Ignore storage errors; runtime flow should still work.
  }
}
