import { createHmac } from 'node:crypto';
import { env } from './env.js';

export type TurnCredentials = {
  username: string;
  credential: string;
  ttlSeconds: number;
  expiresAtUnix: number;
  urls: string[];
};

export function issueTurnCredentials(subject: string): TurnCredentials {
  const nowUnix = Math.floor(Date.now() / 1000);
  const expiresAtUnix = nowUnix + env.TURN_CREDENTIALS_TTL_SECONDS;
  const username = `${expiresAtUnix}:${subject}`;

  const credential = createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');

  return {
    username,
    credential,
    ttlSeconds: env.TURN_CREDENTIALS_TTL_SECONDS,
    expiresAtUnix,
    urls: [
      `turn:${env.TURN_HOST}:3478?transport=udp`,
      `turn:${env.TURN_HOST}:3478?transport=tcp`,
      `turns:${env.TURN_HOST}:5349?transport=tcp`
    ]
  };
}
