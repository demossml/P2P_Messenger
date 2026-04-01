import { describe, expect, it, vi } from 'vitest';
import { decodeJwt } from 'jose';

vi.mock('./env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 3001,
    ALLOWED_ORIGIN: 'http://localhost:5173',
    JWT_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDAHmA7LvepeqDX
lLCCkLImdYn2nLrgcgD/heVxDzDYtYAODXwCrTH4fai4vPPG9Q6zCjUIgcPcVQHv
FDF4qnOlK4k7PgiB9SCCfafnkI7x6gwEto1Vq1lp7u9fJ4xe6PbXw6QBnXVrMDBr
D6mG03vAHbs6Lr6/o99+D08MBlAeRZvN0xKnMPHITt+tHM2yw4p+4V/dBMESFtI8
4TpIYkFfJ7FT6/WCmdIWlskQrfdySr7EbXffvH5JE/vNrBeAyajwkyogqRZqNZjZ
QG+h3QqfuEbmL3/e27l/jJUHH2pDGeKhzMjqSULTXS8zGTQqoZbFEjm70DlteYy6
aw6rhj9zAgMBAAECggEAQ5bMMzYgYmsmiAGjIaQnUNl8OptEMa9aA4uHP4HhJPSh
ww/iZ4yoLmyC/c9YElBnpfx60O3aSrtLbWGU0AdjnSHWa1W1J4dmMxJjDlgwuhIl
vUi+K3wXfmnVpAvlWgSqxxjoq7rKMvYmqpu9gBYKDPpIwrzsVb6g45geLrRP3n3x
MzLQJl09avPyh9jty6SlHUCc8QviYvj5aFUmfslJGwUtC8lnOQvpz4vWmjZ47E9h
iqP540/vyYmS/XpJgQym0EK3LGRsMYaiHjTONyyPCdMNtchQclRnsWJP86IcApff
BHGtdk8ZCsNc+0J6+PTUHW4Xy5DBdlwAIQS39uL9HQKBgQDwuUmAYY1xkcYWQpWB
U6n9rXRGRHVUUZqyuzbfliQXjyoZ6HlQVvpYcCF3ZQN8eDMHxx4RmusXsYqG+Vj3
Qaa5UE+/hyNv2aY/8gc802KT3cY/QPLvgnfIKrp+FUbUbRP8cbh0TWq3eLJNvRu+
k4rxvxlyHCi97Sr6LVLuNcpTBwKBgQDMT3eehydymTFk3NYDORr/BVBzoTNQUXuJ
Mxq5yM/7eb/NOd4DPKdX5xJLOYCetZUwDXQ2McoCr52dJPbA4LrpfKkmW8VSHVgp
uNzwCEobdpITcy7qY6dMvY0YrtZ5Xu6PIUbYaySlU3UBZdRxEmhslUW9I/hTAEsg
BCv5UIW5NQKBgQCeyMln6nEfMZWlB0SQqvwdPbXNx8hQ1wcg0AbRErs54xBVSJgE
22qEvWoF1FapWqvmfHwkBrj9xvlmMMFzTxXHdOc1odFJLRrRYTdO8uw6NvZWsOPO
ApQ6L50WH7i51D1zrhuKc6pp3S5Xwt6zJaVn8rK5J0Pki7VmklD6mfacLwKBgFK4
IfA3PEtzpsH1f1iSuFFkL2yBaastMl0cKcfqe/qPEo7ezPp2hjJaxddbEq4vSpXH
/LMseWOZArFrE9SHqGV8KWf0Y/GZG+bYh+tPD+IKoZ3qVqZjborte8DwmLlPLDsa
9/oLdyzQm2DTf63ADDNaRIANni7MwZ3W0o8AgQO5AoGBAK8C6vl1CqIMCcpI1Mgh
oj7YcGpdZEHMzVATDJpfrReq51G69bgcEISkHLqFM4iiKYj5ChHSRIoozMso8Tjh
+sEzQT8npz9ke/HOhHyr3PbJ0seyzMCeYfZV1vIYT8HlXSH4JOtTeDlYAisPuylH
IFPKaEFpKctYu/B+oT3VAnhq
-----END PRIVATE KEY-----`,
    JWT_PUBLIC_KEY: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwB5gOy73qXqg15SwgpCy
JnWJ9py64HIA/4XlcQ8w2LWADg18Aq0x+H2ouLzzxvUOswo1CIHD3FUB7xQxeKpz
pSuJOz4IgfUggn2n55CO8eoMBLaNVatZae7vXyeMXuj218OkAZ11azAwaw+phtN7
wB27Oi6+v6Pffg9PDAZQHkWbzdMSpzDxyE7frRzNssOKfuFf3QTBEhbSPOE6SGJB
XyexU+v1gpnSFpbJEK33ckq+xG1337x+SRP7zawXgMmo8JMqIKkWajWY2UBvod0K
n7hG5i9/3tu5f4yVBx9qQxnioczI6klC010vMxk0KqGWxRI5u9A5bXmMumsOq4Y/
cwIDAQAB
-----END PUBLIC KEY-----`,
    REDIS_URL: 'redis://localhost:6379',
    POSTGRES_URL: 'postgresql://localhost/p2p',
    TURN_SECRET: 'x'.repeat(32),
    TURN_HOST: 'turn.localhost',
    TURN_REALM: 'turn.localhost',
    TURN_CREDENTIALS_TTL_SECONDS: 3600,
    ROOM_MAX_PEERS: 8,
    ROOM_TTL_SECONDS: 86400,
    WS_RATE_LIMIT_PER_SECOND: 10
  }
}));

const { AuthService } = await import('./auth-service.js');

class FakeRedis {
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly values = new Map<string, string>();

  public async hset(
    key: string,
    fieldOrObject: string | Record<string, string>,
    value?: string
  ): Promise<number> {
    let hash = this.hashes.get(key);
    if (!hash) {
      hash = new Map();
      this.hashes.set(key, hash);
    }

    if (typeof fieldOrObject === 'string') {
      hash.set(fieldOrObject, value ?? '');
      return 1;
    }

    for (const [field, fieldValue] of Object.entries(fieldOrObject)) {
      hash.set(field, fieldValue);
    }
    return Object.keys(fieldOrObject).length;
  }

  public async hgetall(key: string): Promise<Record<string, string>> {
    const hash = this.hashes.get(key);
    if (!hash) {
      return {};
    }
    return Object.fromEntries(hash.entries());
  }

  public async expire(_key: string, _seconds: number): Promise<number> {
    return 1;
  }

  public async set(key: string, value: string, _mode: 'EX', _seconds: number): Promise<'OK'> {
    this.values.set(key, value);
    return 'OK';
  }

  public async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
}

describe('AuthService', () => {
  it('issues session and rotates refresh token', async () => {
    const redis = new FakeRedis();
    const service = new AuthService(redis as never);

    const initial = await service.issueSession('user-1');
    expect(initial.accessToken.length).toBeGreaterThan(20);
    expect(initial.refreshToken.length).toBeGreaterThan(20);

    const rotated = await service.rotate(initial.refreshToken);
    expect(rotated.expiresIn).toBe(initial.expiresIn);
    expect(rotated.refreshExpiresIn).toBe(initial.refreshExpiresIn);

    const initialRefreshPayload = decodeJwt(initial.refreshToken);
    const rotatedRefreshPayload = decodeJwt(rotated.refreshToken);
    expect(rotatedRefreshPayload.tokenId).not.toBe(initialRefreshPayload.tokenId);
    expect(rotatedRefreshPayload.familyId).toBe(initialRefreshPayload.familyId);
  });

  it('revokes token family when old refresh token is reused', async () => {
    const redis = new FakeRedis();
    const service = new AuthService(redis as never);

    const initial = await service.issueSession('user-2');
    const rotated = await service.rotate(initial.refreshToken);

    await expect(service.rotate(initial.refreshToken)).rejects.toMatchObject({
      code: 'TOKEN_REUSE_DETECTED'
    });

    await expect(service.rotate(rotated.refreshToken)).rejects.toMatchObject({
      code: 'UNAUTHORIZED'
    });
  });

  it('rejects invalid refresh token', async () => {
    const redis = new FakeRedis();
    const service = new AuthService(redis as never);

    await expect(service.rotate('not-a-jwt')).rejects.toMatchObject({
      code: 'UNAUTHORIZED'
    });
  });
});
