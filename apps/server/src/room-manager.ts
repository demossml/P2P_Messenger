import type { Redis } from 'ioredis';

export type RoomPeer = {
  peerId: string;
  peerPublicKey: string;
};

export class RoomManager {
  private static readonly ATOMIC_JOIN_SCRIPT = `
local key = KEYS[1]
local peerId = ARGV[1]
local peerPublicKey = ARGV[2]
local maxPeers = tonumber(ARGV[3])
local ttlSeconds = tonumber(ARGV[4])

local current = redis.call('HGETALL', key)
local count = #current / 2
local existingValue = redis.call('HGET', key, peerId)
local isExisting = existingValue ~= false and existingValue ~= nil

if (not isExisting) and count >= maxPeers then
  return { 'full' }
end

redis.call('HSET', key, peerId, peerPublicKey)
redis.call('EXPIRE', key, ttlSeconds)

local result = { 'ok' }
for i = 1, #current, 2 do
  local existingPeerId = current[i]
  local existingPeerPublicKey = current[i + 1]
  if existingPeerId ~= peerId then
    table.insert(result, existingPeerId)
    table.insert(result, existingPeerPublicKey)
  end
end

return result
`;

  public constructor(
    private readonly redis: Redis,
    private readonly roomTtlSeconds: number,
    private readonly maxPeersPerRoom: number
  ) {}

  public async joinRoom(roomId: string, peer: RoomPeer): Promise<RoomPeer[]> {
    const key = this.roomKey(roomId);
    const evalFn = (this.redis as Redis & { eval?: (...args: unknown[]) => Promise<unknown> }).eval;
    if (typeof evalFn === 'function') {
      const raw = await evalFn.call(
        this.redis,
        RoomManager.ATOMIC_JOIN_SCRIPT,
        1,
        key,
        peer.peerId,
        peer.peerPublicKey,
        String(this.maxPeersPerRoom),
        String(this.roomTtlSeconds)
      );

      if (!Array.isArray(raw) || raw.length === 0 || typeof raw[0] !== 'string') {
        throw new Error('ROOM_JOIN_FAILED');
      }

      const status = raw[0];
      if (status === 'full') {
        throw new Error('ROOM_IS_FULL');
      }
      if (status !== 'ok') {
        throw new Error('ROOM_JOIN_FAILED');
      }

      const existingPeers: RoomPeer[] = [];
      for (let index = 1; index < raw.length; index += 2) {
        const peerId = raw[index];
        const peerPublicKey = raw[index + 1];
        if (typeof peerId === 'string' && typeof peerPublicKey === 'string') {
          existingPeers.push({ peerId, peerPublicKey });
        }
      }

      return existingPeers;
    }

    const peers = await this.redis.hgetall(key);
    const existingIds = Object.keys(peers);
    if (!existingIds.includes(peer.peerId) && existingIds.length >= this.maxPeersPerRoom) {
      throw new Error('ROOM_IS_FULL');
    }
    await this.redis.hset(key, peer.peerId, peer.peerPublicKey);
    await this.redis.expire(key, this.roomTtlSeconds);

    return existingIds.map((peerId) => ({
      peerId,
      peerPublicKey: peers[peerId] ?? ''
    }));
  }

  public async leaveRoom(roomId: string, peerId: string): Promise<void> {
    const key = this.roomKey(roomId);
    await this.redis.hdel(key, peerId);

    const count = await this.redis.hlen(key);
    if (count === 0) {
      await this.redis.del(key);
      return;
    }

    await this.redis.expire(key, this.roomTtlSeconds);
  }

  private roomKey(roomId: string): string {
    return `room:${roomId}:peers`;
  }
}
