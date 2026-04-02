import { Redis } from 'ioredis';
import { SignJWT, importPKCS8, importSPKI, jwtVerify } from 'jose';
import { v4 as uuidv4 } from 'uuid';
import { env } from './env.js';

const JWT_ALG = 'RS256';
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

type RefreshClaims = {
  tokenType: 'refresh';
  familyId: string;
  tokenId: string;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
};

export class AuthServiceError extends Error {
  public constructor(
    public readonly code: 'UNAUTHORIZED' | 'TOKEN_REUSE_DETECTED',
    message: string
  ) {
    super(message);
    this.name = 'AuthServiceError';
  }
}

export class AuthService {
  private readonly privateKeyPromise = importPKCS8(this.normalizePem(env.JWT_PRIVATE_KEY), JWT_ALG);
  private readonly publicKeyPromise = importSPKI(this.normalizePem(env.JWT_PUBLIC_KEY), JWT_ALG);

  public constructor(private readonly redis: Redis) {}

  public async issueSession(userId: string): Promise<AuthSession> {
    const familyId = uuidv4();
    const refreshTokenId = uuidv4();

    const accessToken = await this.signAccessToken(userId);
    const refreshToken = await this.signRefreshToken(userId, familyId, refreshTokenId);

    await this.storeRefreshToken(refreshTokenId, familyId, userId);

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TTL_SECONDS,
      refreshExpiresIn: REFRESH_TTL_SECONDS
    };
  }

  public async rotate(refreshToken: string): Promise<AuthSession> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const userId = payload.sub;

    if (typeof userId !== 'string' || userId.length === 0) {
      throw new AuthServiceError('UNAUTHORIZED', 'Refresh token subject is invalid.');
    }

    if (await this.isFamilyRevoked(payload.familyId)) {
      throw new AuthServiceError('UNAUTHORIZED', 'Token family is revoked.');
    }

    const tokenMeta = await this.redis.hgetall(this.refreshTokenKey(payload.tokenId));
    if (Object.keys(tokenMeta).length === 0 || tokenMeta.status !== 'active') {
      await this.revokeFamily(payload.familyId);
      throw new AuthServiceError('TOKEN_REUSE_DETECTED', 'Refresh token reuse detected.');
    }

    if (tokenMeta.familyId !== payload.familyId || tokenMeta.sub !== userId) {
      await this.revokeFamily(payload.familyId);
      throw new AuthServiceError('TOKEN_REUSE_DETECTED', 'Token metadata mismatch.');
    }

    await this.redis.hset(this.refreshTokenKey(payload.tokenId), {
      status: 'used',
      usedAt: String(Date.now())
    });

    const nextRefreshTokenId = uuidv4();
    const nextAccessToken = await this.signAccessToken(userId);
    const nextRefreshToken = await this.signRefreshToken(
      userId,
      payload.familyId,
      nextRefreshTokenId
    );

    await this.storeRefreshToken(nextRefreshTokenId, payload.familyId, userId);

    return {
      accessToken: nextAccessToken,
      refreshToken: nextRefreshToken,
      expiresIn: ACCESS_TTL_SECONDS,
      refreshExpiresIn: REFRESH_TTL_SECONDS
    };
  }

  public async revoke(refreshToken: string): Promise<void> {
    const payload = await this.verifyRefreshToken(refreshToken);
    await this.revokeFamily(payload.familyId);
  }

  private async signAccessToken(userId: string): Promise<string> {
    const key = await this.privateKeyPromise;

    return new SignJWT({ tokenType: 'access' })
      .setProtectedHeader({ alg: JWT_ALG })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .sign(key);
  }

  private async signRefreshToken(
    userId: string,
    familyId: string,
    tokenId: string
  ): Promise<string> {
    const key = await this.privateKeyPromise;

    return new SignJWT({
      tokenType: 'refresh',
      familyId,
      tokenId
    })
      .setProtectedHeader({ alg: JWT_ALG })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${REFRESH_TTL_SECONDS}s`)
      .sign(key);
  }

  private async verifyRefreshToken(token: string): Promise<RefreshClaims & { sub?: string }> {
    try {
      const key = await this.publicKeyPromise;
      const { payload } = await jwtVerify(token, key, {
        algorithms: [JWT_ALG]
      });

      if (payload.tokenType !== 'refresh') {
        throw new AuthServiceError('UNAUTHORIZED', 'Expected refresh token.');
      }

      if (typeof payload.familyId !== 'string' || typeof payload.tokenId !== 'string') {
        throw new AuthServiceError('UNAUTHORIZED', 'Refresh token claims are missing.');
      }

      return payload as RefreshClaims & { sub?: string };
    } catch (error) {
      if (error instanceof AuthServiceError) {
        throw error;
      }

      throw new AuthServiceError('UNAUTHORIZED', 'Invalid refresh token.');
    }
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.redis.set(this.familyRevokedKey(familyId), '1', 'EX', REFRESH_TTL_SECONDS);
  }

  private async isFamilyRevoked(familyId: string): Promise<boolean> {
    return (await this.redis.get(this.familyRevokedKey(familyId))) === '1';
  }

  private async storeRefreshToken(
    tokenId: string,
    familyId: string,
    userId: string
  ): Promise<void> {
    const key = this.refreshTokenKey(tokenId);
    await this.redis.hset(key, {
      familyId,
      sub: userId,
      status: 'active',
      createdAt: String(Date.now())
    });
    await this.redis.expire(key, REFRESH_TTL_SECONDS);
  }

  private refreshTokenKey(tokenId: string): string {
    return `auth:refresh:${tokenId}`;
  }

  private familyRevokedKey(familyId: string): string {
    return `auth:family:${familyId}:revoked`;
  }

  private normalizePem(value: string): string {
    return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
  }
}
