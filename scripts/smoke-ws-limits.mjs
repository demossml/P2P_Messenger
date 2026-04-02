import { randomUUID } from 'node:crypto';
import {
  connectSocket,
  DEFAULT_TIMEOUT_MS,
  expectErrorCodeForPayload,
  issueAccessToken,
  waitForErrorCode
} from './smoke-lib/ws-helpers.mjs';

const API_BASE_URL = process.env.P2P_API_BASE_URL ?? 'http://127.0.0.1:3001';
const SIGNALING_WS_URL = process.env.P2P_SIGNALING_WS_URL ?? 'ws://127.0.0.1:3001/ws';
const ORIGIN = process.env.P2P_ALLOWED_ORIGIN ?? 'http://localhost:5173';
const TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
const LOG_PREFIX = '[smoke:ws:limits]';

async function main() {
  const startedAt = Date.now();
  const oversizedPeerKeyToken = await issueAccessToken({
    apiBaseUrl: API_BASE_URL,
    userId: 'smoke-ws-limits-oversized-key',
    logPrefix: LOG_PREFIX
  });
  const connectSocketFn = () =>
    connectSocket({
      signalingWsUrl: SIGNALING_WS_URL,
      origin: ORIGIN,
      logPrefix: LOG_PREFIX,
      timeoutMs: TIMEOUT_MS
    });
  const waitForErrorCodeFn = (messages, code) =>
    waitForErrorCode({
      messages,
      code,
      logPrefix: LOG_PREFIX,
      timeoutMs: TIMEOUT_MS
    });

  await expectErrorCodeForPayload({
    payload: {
      type: 'join',
      roomId: `smoke-room-limits-key-${Date.now()}`,
      peerId: randomUUID(),
      token: oversizedPeerKeyToken,
      peerPublicKey: 'x'.repeat(4097)
    },
    expectedCode: 'SCHEMA_VALIDATION_FAILED',
    connectSocketFn,
    waitForErrorCodeFn,
    logPrefix: LOG_PREFIX,
    label: 'oversized-peer-public-key',
    retryDelayMs: 120
  });

  await expectErrorCodeForPayload({
    payload: {
      type: 'offer',
      to: randomUUID(),
      sdp: {
        type: 'offer',
        sdp: 'x'.repeat(7501)
      }
    },
    expectedCode: 'SCHEMA_VALIDATION_FAILED',
    connectSocketFn,
    waitForErrorCodeFn,
    logPrefix: LOG_PREFIX,
    label: 'oversized-offer-sdp',
    retryDelayMs: 120
  });

  await expectErrorCodeForPayload({
    payload: {
      type: 'ice-candidate',
      to: randomUUID(),
      candidate: {
        candidate: 'x'.repeat(4097),
        sdpMid: '0',
        sdpMLineIndex: 0
      }
    },
    expectedCode: 'SCHEMA_VALIDATION_FAILED',
    connectSocketFn,
    waitForErrorCodeFn,
    logPrefix: LOG_PREFIX,
    label: 'oversized-ice-candidate',
    retryDelayMs: 120
  });

  const durationMs = Date.now() - startedAt;
  console.log(`${LOG_PREFIX} PASS in ${durationMs}ms. origin=${ORIGIN} ws=${SIGNALING_WS_URL}`);
}

main().catch((error) => {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
