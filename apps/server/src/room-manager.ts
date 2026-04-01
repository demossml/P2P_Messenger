import type { Redis } from 'ioredis';

export type RoomPeer = {
  peerId: string;
  peerPublicKey: string;
};

export class RoomManager {
  public constructor(
    private readonly redis: Redis,
    private readonly roomTtlSeconds: number,
    private readonly maxPeersPerRoom: number
  ) {}

  public async joinRoom(roomId: string, peer: RoomPeer): Promise<RoomPeer[]> {
    const key = this.roomKey(roomId);
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
