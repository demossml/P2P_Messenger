import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

const API_BASE_URL = process.env.P2P_API_BASE_URL ?? 'http://127.0.0.1:3001';
const SIGNALING_WS_URL = process.env.P2P_SIGNALING_WS_URL ?? 'ws://127.0.0.1:3001/ws';
const ORIGIN = process.env.P2P_ALLOWED_ORIGIN ?? 'http://localhost:5173';
const EXPECTED_ROOM_MAX_PEERS = Number(process.env.P2P_EXPECT_ROOM_MAX_PEERS ?? 8);
const TIMEOUT_MS = 8000;
const MAX_SIGNALING_MESSAGE_BYTES = 8 * 1024;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`[smoke:ws:negative] HTTP ${response.status} on ${url}: ${body}`);
  }

  return response.json();
}

async function issueAccessToken(userId) {
  const result = await fetchJson(
    `${API_BASE_URL}/auth/dev-login?userId=${encodeURIComponent(userId)}`
  );
  if (!result?.accessToken) {
    throw new Error('[smoke:ws:negative] dev-login did not return accessToken.');
  }
  return result.accessToken;
}

function connectSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SIGNALING_WS_URL, {
      headers: {
        Origin: ORIGIN
      }
    });

    const messages = [];
    const timeoutId = setTimeout(() => {
      reject(new Error('[smoke:ws:negative] Timeout while opening WebSocket.'));
      ws.close();
    }, TIMEOUT_MS);

    ws.on('open', () => {
      clearTimeout(timeoutId);
      resolve({ ws, messages });
    });

    ws.on('message', (data) => {
      const parsed = parseJson(String(data));
      if (parsed) {
        messages.push(parsed);
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

function expectOriginRejectedConnection() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SIGNALING_WS_URL, {
      headers: {
        Origin: 'http://malicious.local'
      }
    });

    const timeoutId = setTimeout(() => {
      reject(new Error('[smoke:ws:negative] Timeout waiting for invalid-origin rejection.'));
      ws.terminate();
    }, TIMEOUT_MS);

    ws.on('open', () => {
      clearTimeout(timeoutId);
      reject(new Error('[smoke:ws:negative] Invalid origin unexpectedly upgraded.'));
      ws.close(1000, 'done');
    });

    ws.on('unexpected-response', (_request, response) => {
      clearTimeout(timeoutId);
      if (response.statusCode !== 403) {
        reject(
          new Error(
            `[smoke:ws:negative] Expected 403 for invalid origin, got ${response.statusCode ?? 'unknown'}.`
          )
        );
        return;
      }
      resolve();
    });

    ws.on('error', () => {
      // `ws` can emit error before/after unexpected-response for rejected handshake.
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
      reject(new Error('[smoke:ws:negative] Timeout waiting for oversized payload rejection.'));
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

async function connectJoinedPeer({ roomId, token, peerId, peerPublicKey }) {
  const connected = await connectSocket();
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

async function waitForErrorCode(messages, code, timeoutMs = TIMEOUT_MS) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const index = messages.findIndex(
      (message) => message.type === 'error' && message.code === code
    );
    if (index >= 0) {
      return messages.splice(index, 1)[0];
    }
    await delay(20);
  }

  const observedCodes = messages
    .filter((message) => message?.type === 'error' && typeof message.code === 'string')
    .map((message) => message.code);
  const observedSuffix =
    observedCodes.length > 0
      ? ` Observed codes: ${observedCodes.join(', ')}.`
      : ' Observed codes: none.';
  throw new Error(`[smoke:ws:negative] Timeout waiting for error code ${code}.${observedSuffix}`);
}

async function expectErrorCodeForPayload(payload, expectedCode, attempts = 3, label = 'payload') {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const socket = await connectSocket();
    socket.ws.send(JSON.stringify(payload));

    try {
      await waitForErrorCode(socket.messages, expectedCode);
      socket.ws.close(1000, 'done');
      return;
    } catch (error) {
      lastError = error;
      socket.ws.close(1000, 'done');
      if (attempt < attempts) {
        await delay(100);
      }
    }
  }

  if (lastError instanceof Error) {
    throw new Error(`[smoke:ws:negative] ${label}: ${lastError.message}`);
  }
  throw new Error(
    `[smoke:ws:negative] ${label}: failed waiting for ${expectedCode} after ${attempts} attempts.`
  );
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

  throw new Error(`[smoke:ws:negative] Timeout waiting for peer-joined ${peerId.slice(0, 8)}.`);
}

async function main() {
  const startedAt = Date.now();

  await expectOriginRejectedConnection();
  await expectOversizedPayloadRejected();

  const invalidJsonSocket = await connectSocket();
  invalidJsonSocket.ws.send('{');
  await waitForErrorCode(invalidJsonSocket.messages, 'INVALID_JSON');
  invalidJsonSocket.ws.close(1000, 'done');

  await expectErrorCodeForPayload(
    {
      type: 'join',
      roomId: 'x'
    },
    'SCHEMA_VALIDATION_FAILED',
    3,
    'invalid-schema'
  );

  await expectErrorCodeForPayload(
    {
      type: 'join',
      roomId: `smoke-room-invalid-key-type-${Date.now()}`,
      peerId: randomUUID(),
      token: await issueAccessToken('smoke-oversized-key'),
      peerPublicKey: 42
    },
    'SCHEMA_VALIDATION_FAILED',
    3,
    'invalid-peer-public-key-type'
  );

  const malformedBundleRoomId = `smoke-room-malformed-bundle-${Date.now()}`;
  const malformedBundleToken = await issueAccessToken('smoke-malformed-bundle');
  const observerToken = await issueAccessToken('smoke-malformed-observer');
  const malformedPeerId = randomUUID();
  const observerPeerId = randomUUID();

  const malformedPeer = await connectJoinedPeer({
    roomId: malformedBundleRoomId,
    token: malformedBundleToken,
    peerId: malformedPeerId,
    // Intentionally malformed bundle marker + invalid base64 payload.
    peerPublicKey: 'p2p-key-bundle-v1:@@@not_base64@@@'
  });
  const observerPeer = await connectJoinedPeer({
    roomId: malformedBundleRoomId,
    token: observerToken,
    peerId: observerPeerId,
    peerPublicKey: `smoke-observer-key-${Date.now()}`
  });

  const observerSawMalformedPeer = await waitForPeerJoined(observerPeer.messages, malformedPeerId);
  const malformedSawObserver = await waitForPeerJoined(malformedPeer.messages, observerPeerId);

  if (observerSawMalformedPeer.peerPublicKey !== 'p2p-key-bundle-v1:@@@not_base64@@@') {
    throw new Error('[smoke:ws:negative] Malformed bundle peerPublicKey was unexpectedly altered.');
  }
  if (
    typeof malformedSawObserver.peerPublicKey !== 'string' ||
    malformedSawObserver.peerPublicKey.length === 0
  ) {
    throw new Error(
      '[smoke:ws:negative] Observer peerPublicKey was not propagated to malformed-bundle peer.'
    );
  }

  malformedPeer.ws.close(1000, 'done');
  observerPeer.ws.close(1000, 'done');

  const rateLimitedSocket = await connectSocket();
  for (let index = 0; index < 24; index += 1) {
    rateLimitedSocket.ws.send('{');
  }
  await waitForErrorCode(rateLimitedSocket.messages, 'RATE_LIMITED');
  rateLimitedSocket.ws.close(1000, 'done');

  const roomId = `smoke-room-full-${Date.now()}`;
  const joinedPeers = [];
  try {
    for (let index = 0; index < EXPECTED_ROOM_MAX_PEERS; index += 1) {
      const token = await issueAccessToken(`smoke-room-peer-${index}`);
      const joined = await connectJoinedPeer({
        roomId,
        token,
        peerId: randomUUID(),
        peerPublicKey: `smoke-room-key-${index}-${Date.now()}`
      });
      joinedPeers.push(joined);
      await delay(20);
    }

    const extraToken = await issueAccessToken('smoke-room-over-capacity');
    const overCapacityPeer = await connectJoinedPeer({
      roomId,
      token: extraToken,
      peerId: randomUUID(),
      peerPublicKey: `smoke-room-key-over-${Date.now()}`
    });
    await waitForErrorCode(overCapacityPeer.messages, 'ROOM_IS_FULL');
    overCapacityPeer.ws.close(1000, 'done');
  } finally {
    for (const peer of joinedPeers) {
      peer.ws.close(1000, 'done');
    }
  }

  const durationMs = Date.now() - startedAt;
  console.log('[smoke:ws:negative] PASS');
  console.log(`[smoke:ws:negative] api=${API_BASE_URL}`);
  console.log(`[smoke:ws:negative] ws=${SIGNALING_WS_URL}`);
  console.log(`[smoke:ws:negative] origin=${ORIGIN}`);
  console.log(`[smoke:ws:negative] expectedRoomMaxPeers=${EXPECTED_ROOM_MAX_PEERS}`);
  console.log(`[smoke:ws:negative] duration=${durationMs}ms`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
