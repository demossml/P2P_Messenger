import { describe, expect, it } from 'vitest';
import { RoomManager } from './room-manager.js';

type HashStore = Map<string, Map<string, string>>;
type ExpiryStore = Map<string, number>;

class FakeRedis {
  private readonly hashes: HashStore = new Map();
  private readonly expirySeconds: ExpiryStore = new Map();

  public async hgetall(key: string): Promise<Record<string, string>> {
    const hash = this.hashes.get(key);
    if (!hash) {
      return {};
    }

    return Object.fromEntries(hash.entries());
  }

  public async hset(key: string, field: string, value: string): Promise<number> {
    let hash = this.hashes.get(key);
    if (!hash) {
      hash = new Map();
      this.hashes.set(key, hash);
    }

    hash.set(field, value);
    return 1;
  }

  public async hdel(key: string, field: string): Promise<number> {
    const hash = this.hashes.get(key);
    if (!hash) {
      return 0;
    }

    const existed = hash.delete(field);
    if (hash.size === 0) {
      this.hashes.delete(key);
    }

    return existed ? 1 : 0;
  }

  public async hlen(key: string): Promise<number> {
    return this.hashes.get(key)?.size ?? 0;
  }

  public async del(key: string): Promise<number> {
    const existed = this.hashes.delete(key);
    this.expirySeconds.delete(key);
    return existed ? 1 : 0;
  }

  public async expire(key: string, seconds: number): Promise<number> {
    this.expirySeconds.set(key, seconds);
    return 1;
  }

  public getExpiryForKey(key: string): number | undefined {
    return this.expirySeconds.get(key);
  }
}

describe('RoomManager', () => {
  it('returns existing peers when joining and refreshes room ttl', async () => {
    const redis = new FakeRedis();
    const manager = new RoomManager(redis as never, 3600, 8);
    const roomId = 'room-alpha';

    await manager.joinRoom(roomId, {
      peerId: '11111111-1111-4111-8111-111111111111',
      peerPublicKey: 'pub-1'
    });

    const existing = await manager.joinRoom(roomId, {
      peerId: '22222222-2222-4222-8222-222222222222',
      peerPublicKey: 'pub-2'
    });

    expect(existing).toEqual([
      {
        peerId: '11111111-1111-4111-8111-111111111111',
        peerPublicKey: 'pub-1'
      }
    ]);
    expect(redis.getExpiryForKey('room:room-alpha:peers')).toBe(3600);
  });

  it('rejects join when room is full and peer is new', async () => {
    const redis = new FakeRedis();
    const manager = new RoomManager(redis as never, 3600, 1);
    const roomId = 'room-capacity';

    await manager.joinRoom(roomId, {
      peerId: '11111111-1111-4111-8111-111111111111',
      peerPublicKey: 'pub-1'
    });

    await expect(
      manager.joinRoom(roomId, {
        peerId: '22222222-2222-4222-8222-222222222222',
        peerPublicKey: 'pub-2'
      })
    ).rejects.toThrowError('ROOM_IS_FULL');
  });

  it('removes room key when last peer leaves and extends ttl otherwise', async () => {
    const redis = new FakeRedis();
    const manager = new RoomManager(redis as never, 1800, 8);
    const roomId = 'room-leave';

    await manager.joinRoom(roomId, {
      peerId: '11111111-1111-4111-8111-111111111111',
      peerPublicKey: 'pub-1'
    });
    await manager.joinRoom(roomId, {
      peerId: '22222222-2222-4222-8222-222222222222',
      peerPublicKey: 'pub-2'
    });

    await manager.leaveRoom(roomId, '11111111-1111-4111-8111-111111111111');
    expect(redis.getExpiryForKey('room:room-leave:peers')).toBe(1800);

    await manager.leaveRoom(roomId, '22222222-2222-4222-8222-222222222222');
    expect(await redis.hlen('room:room-leave:peers')).toBe(0);
  });
});
