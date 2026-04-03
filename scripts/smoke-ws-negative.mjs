import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { WebSocket } from 'ws';
import {
  connectSocket,
  DEFAULT_TIMEOUT_MS,
  delay,
  expectErrorCodeForPayload,
  issueAccessToken,
  waitForErrorCode
} from './smoke-lib/ws-helpers.mjs';

const API_BASE_URL = process.env.P2P_API_BASE_URL ?? 'http://127.0.0.1:3001';
const SIGNALING_WS_URL = process.env.P2P_SIGNALING_WS_URL ?? 'ws://127.0.0.1:3001/ws';
const ORIGIN = process.env.P2P_ALLOWED_ORIGIN ?? 'http://localhost:5173';
const EXPECTED_ROOM_MAX_PEERS = Number(process.env.P2P_EXPECT_ROOM_MAX_PEERS ?? 8);
const TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
const MAX_SIGNALING_MESSAGE_BYTES = 8 * 1024;
const LOG_PREFIX = '[smoke:ws:negative]';
const SUMMARY_PATH =
  process.env.P2P_SMOKE_WS_NEGATIVE_SUMMARY_PATH ??
  'artifacts/security/smoke-ws-negative-summary.json';

function expectOriginRejectedConnection() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SIGNALING_WS_URL, {
      headers: {
        Origin: 'http://malicious.local'
      }
    });

    const timeoutId = setTimeout(() => {
      reject(new Error(`${LOG_PREFIX} Timeout waiting for invalid-origin rejection.`));
      ws.terminate();
    }, TIMEOUT_MS);

    ws.on('open', () => {
      clearTimeout(timeoutId);
      reject(new Error(`${LOG_PREFIX} Invalid origin unexpectedly upgraded.`));
      ws.close(1000, 'done');
    });

    ws.on('unexpected-response', (_request, response) => {
      clearTimeout(timeoutId);
      if (response.statusCode !== 403) {
        reject(
          new Error(
            `${LOG_PREFIX} Expected 403 for invalid origin, got ${response.statusCode ?? 'unknown'}.`
          )
        );
        return;
      }
      resolve();
    });

    ws.on('error', () => {
      // ws can emit error before/after unexpected-response for rejected handshake.
      // We rely on unexpected-response for status assertion and ignore this signal.
    });
  });
}

function expectOversizedPayloadRejected() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SIGNALING_WS_URL, {
      headers: {
        Origin: ORIGIN
      }
    });

    const timeoutId = setTimeout(() => {
      reject(new Error(`${LOG_PREFIX} Timeout waiting for oversized payload rejection.`));
      ws.terminate();
    }, TIMEOUT_MS);

    ws.on('open', () => {
      const oversizedOffer = JSON.stringify({
        type: 'offer',
        to: randomUUID(),
        sdp: {
          type: 'offer',
          sdp: 'x'.repeat(MAX_SIGNALING_MESSAGE_BYTES + 2048)
        }
      });
      ws.send(oversizedOffer);
    });

    ws.on('close', () => {
      clearTimeout(timeoutId);
      resolve();
    });

    ws.on('unexpected-response', () => {
      clearTimeout(timeoutId);
      resolve();
    });

    ws.on('error', () => {
      // For oversized frames some runtimes emit error before/after close.
      // We still treat this path as rejection success.
    });
  });
}

async function connectJoinedPeer({ roomId, token, peerId, peerPublicKey }, connectSocketFn) {
  const connected = await connectSocketFn();
  connected.ws.send(
    JSON.stringify({
      type: 'join',
      roomId,
      peerId,
      token,
      peerPublicKey
    })
  );

  return connected;
}

async function waitForPeerJoined(messages, peerId, timeoutMs = TIMEOUT_MS) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const index = messages.findIndex(
      (message) => message.type === 'peer-joined' && message.peerId === peerId
    );
    if (index >= 0) {
      return messages.splice(index, 1)[0];
    }
    await delay(20);
  }

  throw new Error(`${LOG_PREFIX} Timeout waiting for peer-joined ${peerId.slice(0, 8)}.`);
}

async function main() {
  const startedAt = Date.now();
  const records = [];
  let failedStep = null;
  let errorMessage = null;

  async function runStep(label, stepFn) {
    const stepStartedAt = Date.now();
    try {
      await stepFn();
      records.push({
        label,
        status: 'pass',
        durationMs: Date.now() - stepStartedAt
      });
    } catch (error) {
      failedStep = label;
      errorMessage = error instanceof Error ? error.message : String(error);
      records.push({
        label,
        status: 'fail',
        durationMs: Date.now() - stepStartedAt
      });
      throw error;
    }
  }

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

  try {
    await runStep('origin-rejected', async () => {
      await expectOriginRejectedConnection();
    });
    await runStep('oversized-payload-rejected', async () => {
      await expectOversizedPayloadRejected();
    });

    await runStep('invalid-json', async () => {
      const invalidJsonSocket = await connectSocketFn();
      invalidJsonSocket.ws.send('{');
      await waitForErrorCodeFn(invalidJsonSocket.messages, 'INVALID_JSON');
      invalidJsonSocket.ws.close(1000, 'done');
    });

    await runStep('invalid-schema', async () => {
      await expectErrorCodeForPayload({
        payload: {
          type: 'join',
          roomId: 'x'
        },
        expectedCode: 'SCHEMA_VALIDATION_FAILED',
        connectSocketFn,
        waitForErrorCodeFn,
        logPrefix: LOG_PREFIX,
        label: 'invalid-schema'
      });
    });

    await runStep('invalid-peer-public-key-type', async () => {
      await expectErrorCodeForPayload({
        payload: {
          type: 'join',
          roomId: `smoke-room-invalid-key-type-${Date.now()}`,
          peerId: randomUUID(),
          token: await issueAccessToken({
            apiBaseUrl: API_BASE_URL,
            userId: 'smoke-oversized-key',
            logPrefix: LOG_PREFIX
          }),
          peerPublicKey: 42
        },
        expectedCode: 'SCHEMA_VALIDATION_FAILED',
        connectSocketFn,
        waitForErrorCodeFn,
        logPrefix: LOG_PREFIX,
        label: 'invalid-peer-public-key-type'
      });
    });

    await runStep('oversized-peer-public-key', async () => {
      await expectErrorCodeForPayload({
        payload: {
          type: 'join',
          roomId: `smoke-room-oversized-key-${Date.now()}`,
          peerId: randomUUID(),
          token: await issueAccessToken({
            apiBaseUrl: API_BASE_URL,
            userId: 'smoke-oversized-key',
            logPrefix: LOG_PREFIX
          }),
          peerPublicKey: 'x'.repeat(4097)
        },
        expectedCode: 'SCHEMA_VALIDATION_FAILED',
        connectSocketFn,
        waitForErrorCodeFn,
        logPrefix: LOG_PREFIX,
        label: 'oversized-peer-public-key'
      });
    });

    await runStep('oversized-offer-sdp', async () => {
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
        label: 'oversized-offer-sdp'
      });
    });

    await runStep('oversized-ice-candidate', async () => {
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
        label: 'oversized-ice-candidate'
      });
    });

    await runStep('malformed-key-bundle-propagation', async () => {
      const malformedBundleRoomId = `smoke-room-malformed-bundle-${Date.now()}`;
      const malformedBundleToken = await issueAccessToken({
        apiBaseUrl: API_BASE_URL,
        userId: 'smoke-malformed-bundle',
        logPrefix: LOG_PREFIX
      });
      const observerToken = await issueAccessToken({
        apiBaseUrl: API_BASE_URL,
        userId: 'smoke-malformed-observer',
        logPrefix: LOG_PREFIX
      });
      const malformedPeerId = randomUUID();
      const observerPeerId = randomUUID();

      const malformedPeer = await connectJoinedPeer(
        {
          roomId: malformedBundleRoomId,
          token: malformedBundleToken,
          peerId: malformedPeerId,
          // Intentionally malformed bundle marker + invalid base64 payload.
          peerPublicKey: 'p2p-key-bundle-v1:@@@not_base64@@@'
        },
        connectSocketFn
      );
      const observerPeer = await connectJoinedPeer(
        {
          roomId: malformedBundleRoomId,
          token: observerToken,
          peerId: observerPeerId,
          peerPublicKey: `smoke-observer-key-${Date.now()}`
        },
        connectSocketFn
      );

      const observerSawMalformedPeer = await waitForPeerJoined(
        observerPeer.messages,
        malformedPeerId
      );
      const malformedSawObserver = await waitForPeerJoined(malformedPeer.messages, observerPeerId);

      if (observerSawMalformedPeer.peerPublicKey !== 'p2p-key-bundle-v1:@@@not_base64@@@') {
        throw new Error(`${LOG_PREFIX} Malformed bundle peerPublicKey was unexpectedly altered.`);
      }
      if (
        typeof malformedSawObserver.peerPublicKey !== 'string' ||
        malformedSawObserver.peerPublicKey.length === 0
      ) {
        throw new Error(
          `${LOG_PREFIX} Observer peerPublicKey was not propagated to malformed-bundle peer.`
        );
      }

      malformedPeer.ws.close(1000, 'done');
      observerPeer.ws.close(1000, 'done');
    });

    await runStep('rate-limited', async () => {
      const rateLimitedSocket = await connectSocketFn();
      for (let index = 0; index < 24; index += 1) {
        rateLimitedSocket.ws.send('{');
      }
      await waitForErrorCodeFn(rateLimitedSocket.messages, 'RATE_LIMITED');
      rateLimitedSocket.ws.close(1000, 'done');
    });

    await runStep('room-is-full', async () => {
      const roomId = `smoke-room-full-${Date.now()}`;
      const joinedPeers = [];
      try {
        for (let index = 0; index < EXPECTED_ROOM_MAX_PEERS; index += 1) {
          const token = await issueAccessToken({
            apiBaseUrl: API_BASE_URL,
            userId: `smoke-room-peer-${index}`,
            logPrefix: LOG_PREFIX
          });
          const joined = await connectJoinedPeer(
            {
              roomId,
              token,
              peerId: randomUUID(),
              peerPublicKey: `smoke-room-key-${index}-${Date.now()}`
            },
            connectSocketFn
          );
          joinedPeers.push(joined);
          await delay(20);
        }

        const extraToken = await issueAccessToken({
          apiBaseUrl: API_BASE_URL,
          userId: 'smoke-room-over-capacity',
          logPrefix: LOG_PREFIX
        });
        const overCapacityPeer = await connectJoinedPeer(
          {
            roomId,
            token: extraToken,
            peerId: randomUUID(),
            peerPublicKey: `smoke-room-key-over-${Date.now()}`
          },
          connectSocketFn
        );
        await waitForErrorCodeFn(overCapacityPeer.messages, 'ROOM_IS_FULL');
        overCapacityPeer.ws.close(1000, 'done');
      } finally {
        for (const peer of joinedPeers) {
          peer.ws.close(1000, 'done');
        }
      }
    });

    const durationMs = Date.now() - startedAt;
    await writeSummary({
      outcome: 'success',
      startedAt,
      finishedAt: Date.now(),
      durationMs,
      records,
      failedStep,
      errorMessage
    });
    console.log(`${LOG_PREFIX} PASS`);
    console.log(`${LOG_PREFIX} api=${API_BASE_URL}`);
    console.log(`${LOG_PREFIX} ws=${SIGNALING_WS_URL}`);
    console.log(`${LOG_PREFIX} origin=${ORIGIN}`);
    console.log(`${LOG_PREFIX} expectedRoomMaxPeers=${EXPECTED_ROOM_MAX_PEERS}`);
    console.log(`${LOG_PREFIX} duration=${durationMs}ms`);
  } catch (error) {
    await writeSummary({
      outcome: 'failure',
      startedAt,
      finishedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      records,
      failedStep: failedStep ?? 'smoke:ws:negative',
      errorMessage: errorMessage ?? (error instanceof Error ? error.message : String(error))
    });
    throw error;
  }
}

async function writeSummary({
  outcome,
  startedAt,
  finishedAt,
  durationMs,
  records,
  failedStep,
  errorMessage
}) {
  const payload = {
    outcome,
    startedAtUnixMs: startedAt,
    finishedAtUnixMs: finishedAt,
    durationMs,
    failedStep,
    errorMessage,
    steps: records.map((record) => ({
      label: record.label,
      status: record.status,
      durationMs: record.durationMs
    }))
  };

  await mkdir(dirname(SUMMARY_PATH), { recursive: true });
  await writeFile(SUMMARY_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
