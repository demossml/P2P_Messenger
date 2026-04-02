import { WebSocket } from 'ws';

export const DEFAULT_TIMEOUT_MS = 8000;

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function fetchJson(url, logPrefix) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${logPrefix} HTTP ${response.status} on ${url}: ${body}`);
  }

  return response.json();
}

export async function issueAccessToken({ apiBaseUrl, userId, logPrefix }) {
  const result = await fetchJson(
    `${apiBaseUrl}/auth/dev-login?userId=${encodeURIComponent(userId)}`,
    logPrefix
  );
  if (!result?.accessToken) {
    throw new Error(`${logPrefix} dev-login did not return accessToken.`);
  }
  return result.accessToken;
}

export function connectSocket({
  signalingWsUrl,
  origin,
  logPrefix,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(signalingWsUrl, {
      headers: {
        Origin: origin
      }
    });

    const messages = [];
    const timeoutId = setTimeout(() => {
      reject(new Error(`${logPrefix} Timeout while opening WebSocket.`));
      ws.close();
    }, timeoutMs);

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

export async function waitForErrorCode({
  messages,
  code,
  logPrefix,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
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
  throw new Error(`${logPrefix} Timeout waiting for error code ${code}.${observedSuffix}`);
}

export async function expectErrorCodeForPayload({
  payload,
  expectedCode,
  connectSocketFn,
  waitForErrorCodeFn,
  logPrefix,
  label = 'payload',
  attempts = 3,
  retryDelayMs = 100
}) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const socket = await connectSocketFn();
    socket.ws.send(JSON.stringify(payload));

    try {
      await waitForErrorCodeFn(socket.messages, expectedCode);
      socket.ws.close(1000, 'done');
      return;
    } catch (error) {
      lastError = error;
      socket.ws.close(1000, 'done');
      if (attempt < attempts) {
        await delay(retryDelayMs);
      }
    }
  }

  if (lastError instanceof Error) {
    throw new Error(`${logPrefix} ${label}: ${lastError.message}`);
  }
  throw new Error(
    `${logPrefix} ${label}: failed waiting for ${expectedCode} after ${attempts} attempts.`
  );
}
