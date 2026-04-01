import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

const API_BASE_URL = process.env.P2P_API_BASE_URL ?? 'http://127.0.0.1:3001';
const SIGNALING_WS_URL = process.env.P2P_SIGNALING_WS_URL ?? 'ws://127.0.0.1:3001/ws';
const ORIGIN = process.env.P2P_ALLOWED_ORIGIN ?? 'http://localhost:5173';
const ROOM_ID = process.env.P2P_SMOKE_ROOM_ID ?? `smoke-room-${Date.now()}`;
const TIMEOUT_MS = 8000;

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
    throw new Error(`[smoke:ws] HTTP ${response.status} on ${url}: ${body}`);
  }

  return response.json();
}

async function issueAccessToken(userId) {
  const result = await fetchJson(`${API_BASE_URL}/auth/dev-login?userId=${encodeURIComponent(userId)}`);
  if (!result?.accessToken) {
    throw new Error('[smoke:ws] dev-login did not return accessToken.');
  }
  return result.accessToken;
}

function connectPeer({ token, roomId, peerId, peerPublicKey }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SIGNALING_WS_URL, {
      headers: {
        Origin: ORIGIN
      }
    });

    const messages = [];

    const timeout = setTimeout(() => {
      reject(new Error(`[smoke:ws] Timeout while connecting peer ${peerId.slice(0, 8)}.`));
      ws.close();
    }, TIMEOUT_MS);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'join',
          roomId,
          peerId,
          token,
          peerPublicKey
        })
      );

      clearTimeout(timeout);
      resolve({ ws, messages });
    });

    ws.on('message', (data) => {
      const parsed = parseJson(String(data));
      if (!parsed) {
        return;
      }
      messages.push(parsed);
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    ws.on('close', (code, reasonBuffer) => {
      const reason = String(reasonBuffer ?? '');
      if (code !== 1000) {
        reject(new Error(`[smoke:ws] Peer socket closed unexpectedly: ${code} ${reason}`));
      }
    });
  });
}

async function waitForMessage(messages, predicate, label, timeoutMs = TIMEOUT_MS) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const index = messages.findIndex(predicate);
    if (index >= 0) {
      return messages.splice(index, 1)[0];
    }
    await delay(50);
  }

  throw new Error(`[smoke:ws] Timeout waiting for: ${label}`);
}

async function main() {
  const startedAt = Date.now();

  const tokenA = await issueAccessToken('smoke-peer-a');
  const tokenB = await issueAccessToken('smoke-peer-b');

  const peerA = {
    peerId: randomUUID(),
    peerPublicKey: `smoke-public-key-a-${Date.now()}`
  };
  const peerB = {
    peerId: randomUUID(),
    peerPublicKey: `smoke-public-key-b-${Date.now()}`
  };

  const { ws: wsA, messages: messagesA } = await connectPeer({
    token: tokenA,
    roomId: ROOM_ID,
    peerId: peerA.peerId,
    peerPublicKey: peerA.peerPublicKey
  });

  const { ws: wsB, messages: messagesB } = await connectPeer({
    token: tokenB,
    roomId: ROOM_ID,
    peerId: peerB.peerId,
    peerPublicKey: peerB.peerPublicKey
  });

  const aSawPeerB = await waitForMessage(
    messagesA,
    (message) => message.type === 'peer-joined' && message.peerId === peerB.peerId,
    'peer-joined (A saw B)'
  );

  const bSawPeerA = await waitForMessage(
    messagesB,
    (message) => message.type === 'peer-joined' && message.peerId === peerA.peerId,
    'peer-joined (B saw A)'
  );

  if (aSawPeerB.peerPublicKey !== peerB.peerPublicKey) {
    throw new Error('[smoke:ws] A got unexpected peerPublicKey for peer B.');
  }
  if (bSawPeerA.peerPublicKey !== peerA.peerPublicKey) {
    throw new Error('[smoke:ws] B got unexpected peerPublicKey for peer A.');
  }

  const peerARejoin = {
    peerId: randomUUID(),
    peerPublicKey: `smoke-public-key-a-rejoin-${Date.now()}`
  };

  wsA.send(
    JSON.stringify({
      type: 'join',
      roomId: ROOM_ID,
      peerId: peerARejoin.peerId,
      token: tokenA,
      peerPublicKey: peerARejoin.peerPublicKey
    })
  );

  await waitForMessage(
    messagesB,
    (message) => message.type === 'peer-left' && message.peerId === peerA.peerId,
    'peer-left (B saw old A id leave after rejoin)'
  );
  const bSawPeerARejoin = await waitForMessage(
    messagesB,
    (message) => message.type === 'peer-joined' && message.peerId === peerARejoin.peerId,
    'peer-joined (B saw A rejoin with new id)'
  );
  if (bSawPeerARejoin.peerPublicKey !== peerARejoin.peerPublicKey) {
    throw new Error('[smoke:ws] B got unexpected peerPublicKey for rejoined peer A.');
  }

  wsB.send(
    JSON.stringify({
      type: 'leave',
      roomId: ROOM_ID
    })
  );

  await waitForMessage(
    messagesA,
    (message) => message.type === 'peer-left' && message.peerId === peerB.peerId,
    'peer-left (A saw B leave)'
  );

  wsA.close(1000, 'done');
  wsB.close(1000, 'done');

  const durationMs = Date.now() - startedAt;
  console.log('[smoke:ws] PASS');
  console.log(`[smoke:ws] api=${API_BASE_URL}`);
  console.log(`[smoke:ws] ws=${SIGNALING_WS_URL}`);
  console.log(`[smoke:ws] origin=${ORIGIN}`);
  console.log(`[smoke:ws] room=${ROOM_ID}`);
  console.log(`[smoke:ws] duration=${durationMs}ms`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
