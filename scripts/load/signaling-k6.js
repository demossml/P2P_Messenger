import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.P2P_API_BASE_URL || 'http://127.0.0.1:3001';
const SIGNALING_WS_URL = __ENV.P2P_SIGNALING_WS_URL || 'ws://127.0.0.1:3001/ws';
const ORIGIN = __ENV.P2P_ALLOWED_ORIGIN || 'http://localhost:5173';

const ROOM_POOL_SIZE = Number(__ENV.K6_ROOM_POOL_SIZE || 100);
const JOIN_HOLD_MS = Number(__ENV.K6_JOIN_HOLD_MS || 250);
const THINK_TIME_SECONDS = Number(__ENV.K6_THINK_TIME_SECONDS || 0.2);
const SIGNALING_CONNECT_P95_MS = Number(__ENV.K6_SIGNALING_CONNECT_P95_MS || 50);
const SIGNALING_SESSION_P95_MS = Number(__ENV.K6_SIGNALING_SESSION_P95_MS || 400);

const wsOpenFailed = new Counter('ws_open_failed');
const joinSendFailed = new Counter('join_send_failed');
const wsSessionErrors = new Counter('ws_session_errors');
const loginFailed = new Counter('login_failed');
const wsUpgradeSuccessRate = new Rate('ws_upgrade_success_rate');
const signalingSessionMs = new Trend('signaling_session_ms');

export const options = {
  scenarios: {
    signaling_baseline: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: __ENV.K6_STAGE_1 || '20s', target: Number(__ENV.K6_VUS_1 || 20) },
        { duration: __ENV.K6_STAGE_2 || '30s', target: Number(__ENV.K6_VUS_2 || 40) },
        { duration: __ENV.K6_STAGE_3 || '20s', target: 0 }
      ],
      gracefulRampDown: '5s'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    ws_upgrade_success_rate: ['rate>0.99'],
    ws_open_failed: ['count==0'],
    login_failed: ['count==0'],
    ws_connecting: [`p(95)<${SIGNALING_CONNECT_P95_MS}`],
    signaling_session_ms: [`p(95)<${SIGNALING_SESSION_P95_MS}`]
  }
};

function uuidV4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16);
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

function roomIdForIteration() {
  const roomIndex = (__ITER + __VU) % Math.max(1, ROOM_POOL_SIZE);
  return `k6-room-${roomIndex}`;
}

export default function () {
  const userId = `k6-vu-${__VU}-iter-${__ITER}`;
  const loginResponse = http.get(`${BASE_URL}/auth/dev-login?userId=${encodeURIComponent(userId)}`);

  const loginOk = check(loginResponse, {
    'dev-login status 200': (response) => response.status === 200,
    'dev-login has access token': (response) =>
      response.status === 200 && Boolean(response.json('accessToken'))
  });
  if (!loginOk) {
    loginFailed.add(1);
    sleep(THINK_TIME_SECONDS);
    return;
  }

  const accessToken = loginResponse.json('accessToken');
  const roomId = roomIdForIteration();
  const peerId = uuidV4();
  const peerPublicKey = `k6-public-key-${peerId}`;
  const sessionStartedAt = Date.now();
  let opened = false;
  let joinSent = false;

  const upgradeResponse = ws.connect(
    SIGNALING_WS_URL,
    {
      headers: {
        Origin: ORIGIN
      },
      tags: {
        kind: 'signaling'
      }
    },
    (socket) => {
      socket.on('open', () => {
        opened = true;
        const joinPayload = JSON.stringify({
          type: 'join',
          roomId,
          peerId,
          token: accessToken,
          peerPublicKey
        });

        try {
          socket.send(joinPayload);
          joinSent = true;
        } catch {
          joinSendFailed.add(1);
        }

        socket.setTimeout(() => {
          try {
            socket.send(
              JSON.stringify({
                type: 'leave',
                roomId
              })
            );
          } catch {
            wsSessionErrors.add(1);
          }
          socket.close();
        }, JOIN_HOLD_MS);
      });

      socket.on('error', () => {
        wsSessionErrors.add(1);
      });
    }
  );

  signalingSessionMs.add(Date.now() - sessionStartedAt);
  const upgraded = check(upgradeResponse, {
    'ws upgrade status 101': (response) => response && response.status === 101
  });
  wsUpgradeSuccessRate.add(upgraded ? 1 : 0);

  if (!opened) {
    wsOpenFailed.add(1);
  }
  if (opened && !joinSent) {
    joinSendFailed.add(1);
  }

  sleep(THINK_TIME_SECONDS);
}
