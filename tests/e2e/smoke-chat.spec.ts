import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

type DevSession = {
  accessToken: string;
  refreshToken: string;
};

type PageDiagnostics = {
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
  readonly requestFailures: string[];
};

function attachPageDiagnostics(page: Page): PageDiagnostics {
  const diagnostics: PageDiagnostics = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: []
  };

  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }

    diagnostics.consoleErrors.push(message.text());
  });

  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push(error.message);
  });

  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown_error';
    diagnostics.requestFailures.push(`${request.method()} ${request.url()} -> ${failure}`);
  });

  return diagnostics;
}

function trimDiagnostics(items: string[], maxItems = 6): string {
  if (items.length === 0) {
    return 'none';
  }

  return items.slice(-maxItems).join(' | ');
}

async function issueDevSession(userId: string): Promise<DevSession> {
  const response = await fetch(
    `http://127.0.0.1:3001/auth/dev-login?userId=${encodeURIComponent(userId)}`
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to issue dev session: ${response.status} ${response.statusText} - ${body}`
    );
  }

  const parsed = (await response.json()) as Partial<DevSession>;
  if (!parsed.accessToken || !parsed.refreshToken) {
    throw new Error('Dev session payload is missing accessToken or refreshToken.');
  }

  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken
  };
}

async function seedSession(context: BrowserContext, session: DevSession): Promise<void> {
  await context.addInitScript(
    ([accessToken, refreshToken]) => {
      sessionStorage.setItem('p2p.accessToken', accessToken);
      sessionStorage.setItem('p2p.refreshToken', refreshToken);
    },
    [session.accessToken, session.refreshToken]
  );
}

async function waitForAppReady(
  page: Page,
  label: string,
  diagnostics: PageDiagnostics
): Promise<void> {
  try {
    await expect(page.getByRole('heading', { name: 'P2P Messenger' })).toBeVisible({
      timeout: 75_000
    });
    await expect(page.locator('#roomId')).toBeVisible({ timeout: 75_000 });
  } catch (error) {
    const title = await page.title().catch(() => 'unavailable');
    const location = page.url();
    const bodyText = await page
      .locator('body')
      .innerText()
      .catch(() => 'unavailable');
    const compactBody = bodyText.replace(/\s+/g, ' ').slice(0, 400);
    throw new Error(
      `App is not ready for ${label}: ${
        error instanceof Error ? error.message : String(error)
      }. url=${location}; title=${title}; body="${compactBody}"; consoleErrors=${trimDiagnostics(
        diagnostics.consoleErrors
      )}; pageErrors=${trimDiagnostics(diagnostics.pageErrors)}; requestFailures=${trimDiagnostics(
        diagnostics.requestFailures
      )}`
    );
  }
}

async function installFakeMedia(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const sentPayloadTypes: string[] = [];
    const dataChannelProto = (
      window as typeof window & {
        RTCDataChannel?: {
          prototype?: { send?: (this: RTCDataChannel, data: unknown) => unknown };
        };
      }
    ).RTCDataChannel?.prototype;
    if (dataChannelProto?.send) {
      const nativeSend = dataChannelProto.send;
      dataChannelProto.send = function patchedSend(data: unknown): void {
        if (typeof data === 'string') {
          try {
            const parsed = JSON.parse(data) as { payload?: { type?: unknown } };
            const payloadType = parsed?.payload?.type;
            if (typeof payloadType === 'string') {
              sentPayloadTypes.push(payloadType);
            }
          } catch {
            // Ignore non-JSON payloads.
          }
        }

        nativeSend.call(this, data);
      };
    }

    Object.defineProperty(window, '__e2eGetSentPayloadTypes', {
      configurable: true,
      writable: false,
      value: () => [...sentPayloadTypes]
    });

    Object.defineProperty(window, '__e2eResetSentPayloadTypes', {
      configurable: true,
      writable: false,
      value: () => {
        sentPayloadTypes.length = 0;
      }
    });

    const nativeWebSocket = window.WebSocket;
    const trackedSockets = new Set<WebSocket>();

    class E2ETrackedWebSocket extends nativeWebSocket {
      public constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols as string | string[] | undefined);
        trackedSockets.add(this);
        this.addEventListener('close', () => {
          trackedSockets.delete(this);
        });
      }
    }

    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      writable: true,
      value: E2ETrackedWebSocket
    });

    Object.defineProperty(window, '__e2eForceCloseWebSockets', {
      configurable: true,
      writable: false,
      value: () => {
        let closed = 0;
        for (const socket of trackedSockets) {
          const isSignalingSocket = socket.url.includes(':3001/ws');
          if (!isSignalingSocket) {
            continue;
          }

          if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
            socket.close(4001, 'e2e-forced-close');
            closed += 1;
          }
        }
        return closed;
      }
    });

    const subtle = crypto.subtle as SubtleCrypto & {
      digest: (algorithm: AlgorithmIdentifier, data: BufferSource) => Promise<ArrayBuffer>;
    };
    const nativeDigest = subtle.digest.bind(subtle);
    let corruptNextFileChecksum = false;

    Object.defineProperty(window, '__e2eCorruptNextFileChecksum', {
      configurable: true,
      writable: false,
      value: () => {
        corruptNextFileChecksum = true;
        return true;
      }
    });

    subtle.digest = async (
      algorithm: AlgorithmIdentifier,
      data: BufferSource
    ): Promise<ArrayBuffer> => {
      const digest = await nativeDigest(algorithm, data);
      const algorithmName = typeof algorithm === 'string' ? algorithm : algorithm.name;
      if (!corruptNextFileChecksum || algorithmName.toUpperCase() !== 'SHA-256') {
        return digest;
      }

      corruptNextFileChecksum = false;
      const bytes = new Uint8Array(digest.slice(0));
      if (bytes.length > 0) {
        bytes[0] ^= 0xff;
      }
      return bytes.buffer;
    };

    function createSyntheticStream(): MediaStream {
      const stream = new MediaStream();

      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const canvasCtx = canvas.getContext('2d');
      if (canvasCtx) {
        canvasCtx.fillStyle = '#0f172a';
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
        canvasCtx.fillStyle = '#f8fafc';
        canvasCtx.font = '24px sans-serif';
        canvasCtx.fillText('P2P E2E', 24, 48);
      }

      const videoTrack = canvas.captureStream(12).getVideoTracks()[0];
      if (videoTrack) {
        stream.addTrack(videoTrack);
      }

      const AudioContextCtor =
        window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextCtor) {
        const audioCtx = new AudioContextCtor();
        const oscillator = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const destination = audioCtx.createMediaStreamDestination();

        oscillator.type = 'sine';
        oscillator.frequency.value = 440;
        gain.gain.value = 0.0001;

        oscillator.connect(gain);
        gain.connect(destination);
        oscillator.start();

        const audioTrack = destination.stream.getAudioTracks()[0];
        if (audioTrack) {
          stream.addTrack(audioTrack);
        }
      }

      return stream;
    }

    const mediaDevices = navigator.mediaDevices ?? ({} as MediaDevices);

    mediaDevices.getUserMedia = async () => createSyntheticStream();
    mediaDevices.getDisplayMedia = async () => createSyntheticStream();
    mediaDevices.enumerateDevices = async () => [
      {
        deviceId: 'audio-in-1',
        kind: 'audioinput',
        label: 'Synthetic Microphone',
        groupId: 'synthetic-group',
        toJSON: () => ({})
      },
      {
        deviceId: 'video-in-1',
        kind: 'videoinput',
        label: 'Synthetic Camera',
        groupId: 'synthetic-group',
        toJSON: () => ({})
      },
      {
        deviceId: 'audio-out-1',
        kind: 'audiooutput',
        label: 'Synthetic Speaker',
        groupId: 'synthetic-group',
        toJSON: () => ({})
      }
    ];

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: mediaDevices
    });
  });
}

type ConnectedPeers = {
  contextA: BrowserContext;
  contextB: BrowserContext;
  pageA: Awaited<ReturnType<BrowserContext['newPage']>>;
  pageB: Awaited<ReturnType<BrowserContext['newPage']>>;
};

async function setupConnectedPeers(browser: Browser): Promise<ConnectedPeers> {
  const createPeerContext = async (): Promise<BrowserContext> => {
    const context = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 800 }
    });

    await installFakeMedia(context);
    return context;
  };

  const contextA = await createPeerContext();
  const contextB = await createPeerContext();

  const [sessionA, sessionB] = await Promise.all([
    issueDevSession(`e2e-a-${Date.now()}`),
    issueDevSession(`e2e-b-${Date.now()}`)
  ]);
  await Promise.all([seedSession(contextA, sessionA), seedSession(contextB, sessionB)]);

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const diagnosticsA = attachPageDiagnostics(pageA);
  const diagnosticsB = attachPageDiagnostics(pageB);

  await Promise.all([
    pageA.goto('/', { waitUntil: 'domcontentloaded' }),
    pageB.goto('/', { waitUntil: 'domcontentloaded' })
  ]);
  await Promise.all([
    waitForAppReady(pageA, 'peer A', diagnosticsA),
    waitForAppReady(pageB, 'peer B', diagnosticsB)
  ]);

  const roomId = `e2e-room-${Date.now()}`;

  await pageA.locator('#roomId').fill(roomId);
  await pageB.locator('#roomId').fill(roomId);

  await Promise.all([
    pageA.getByRole('button', { name: 'Connect', exact: true }).click(),
    pageB.getByRole('button', { name: 'Connect', exact: true }).click()
  ]);

  await expect(pageA.getByText('Signaling status: connected')).toBeVisible();
  await expect(pageB.getByText('Signaling status: connected')).toBeVisible();

  await expect(pageA.getByText('Remote peers: 1')).toBeVisible();
  await expect(pageB.getByText('Remote peers: 1')).toBeVisible();

  await Promise.all([
    pageA.evaluate(() => {
      const reset = (window as typeof window & { __e2eResetSentPayloadTypes?: () => void })
        .__e2eResetSentPayloadTypes;
      reset?.();
    }),
    pageB.evaluate(() => {
      const reset = (window as typeof window & { __e2eResetSentPayloadTypes?: () => void })
        .__e2eResetSentPayloadTypes;
      reset?.();
    })
  ]);

  return { contextA, contextB, pageA, pageB };
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('two tabs join one room and see each other as remote peers', async ({ browser }) => {
  const { contextA, contextB } = await setupConnectedPeers(browser);
  await Promise.all([contextA.close(), contextB.close()]);
});

test('@minimal room id persists in UI after page reload', async ({ browser }) => {
  const context = await browser.newContext({
    permissions: ['camera', 'microphone'],
    viewport: { width: 1280, height: 800 }
  });
  await installFakeMedia(context);

  const session = await issueDevSession(`e2e-room-persist-${Date.now()}`);
  await seedSession(context, session);

  const page = await context.newPage();
  const diagnostics = attachPageDiagnostics(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page, 'room persistence check', diagnostics);

  const roomId = `e2e-room-persist-${Date.now()}`;
  const roomInput = page.locator('#roomId');
  await roomInput.fill(roomId);
  await expect(roomInput).toHaveValue(roomId);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page, 'room persistence after reload', diagnostics);
  await expect(page.locator('#roomId')).toHaveValue(roomId);

  await context.close();
});

test('@minimal two tabs complete join -> text -> read receipt flow', async ({ browser }) => {
  const { contextA, contextB, pageA, pageB } = await setupConnectedPeers(browser);

  const chatSectionA = pageA
    .locator('section')
    .filter({ has: pageA.getByRole('heading', { name: 'Chat' }) });

  let completed = false;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const messageText = `e2e-minimal-${Date.now()}-${attempt}`;
    await pageA.getByPlaceholder('Type a message').fill(messageText);
    await pageA.getByRole('button', { name: 'Send', exact: true }).click();

    const messageRowA = chatSectionA.locator('p').filter({ hasText: messageText }).first();
    await expect(messageRowA).toBeVisible({ timeout: 10_000 });

    try {
      await expect(pageB.getByText(messageText).first()).toBeVisible({ timeout: 5_000 });
      await expect(messageRowA).toContainText('(read)', { timeout: 8_000 });
      completed = true;
      break;
    } catch (error) {
      lastError = error;
      await pageA.waitForTimeout(600);
    }
  }

  if (!completed) {
    throw lastError instanceof Error
      ? lastError
      : new Error('Minimal join -> text -> receipt flow did not complete in time.');
  }

  await Promise.all([contextA.close(), contextB.close()]);
});

test('two tabs exchange one text message over DataChannel', async ({ browser }) => {
  const { contextA, contextB, pageA, pageB } = await setupConnectedPeers(browser);

  const messageText = `e2e-chat-${Date.now()}`;
  let delivered = false;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await pageA.getByPlaceholder('Type a message').fill(messageText);
    await pageA.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(pageA.getByText(messageText).first()).toBeVisible();

    try {
      await expect(pageB.getByText(messageText).first()).toBeVisible({ timeout: 5000 });
      delivered = true;
      break;
    } catch (error) {
      lastError = error;
      await pageA.waitForTimeout(600);
    }
  }

  if (!delivered) {
    throw lastError instanceof Error
      ? lastError
      : new Error('Message was not delivered to peer B.');
  }

  await Promise.all([contextA.close(), contextB.close()]);
});

test('chat read receipts and reactions are synchronized between peers', async ({ browser }) => {
  const { contextA, contextB, pageA, pageB } = await setupConnectedPeers(browser);

  const chatSectionA = pageA
    .locator('section')
    .filter({ has: pageA.getByRole('heading', { name: 'Chat' }) });
  const chatSectionB = pageB
    .locator('section')
    .filter({ has: pageB.getByRole('heading', { name: 'Chat' }) });

  let synced = false;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const messageText = `e2e-receipt-${Date.now()}-${attempt}`;
    await pageA.getByPlaceholder('Type a message').fill(messageText);
    await pageA.getByRole('button', { name: 'Send', exact: true }).click();

    const messageRowA = chatSectionA.locator('p').filter({ hasText: messageText }).first();
    const messageRowB = chatSectionB.locator('p').filter({ hasText: messageText }).first();

    try {
      await expect(messageRowB).toBeVisible({ timeout: 5000 });
      await expect(messageRowA).toContainText('(read)', { timeout: 7000 });
      await messageRowB.getByRole('button', { name: /React thumbs up/i }).click();
      await expect(messageRowA).toContainText('👍', { timeout: 5000 });
      synced = true;
      break;
    } catch (error) {
      lastError = error;
      await pageA.waitForTimeout(600);
    }
  }

  if (!synced) {
    throw lastError instanceof Error
      ? lastError
      : new Error('Read receipt or reaction sync did not complete in time.');
  }

  await Promise.all([contextA.close(), contextB.close()]);
});

test('two tabs transfer a small file and receiver marks it completed', async ({ browser }) => {
  const { contextA, contextB, pageA, pageB } = await setupConnectedPeers(browser);

  const fileName = `e2e-${Date.now()}.txt`;
  const fileContents = `hello-file-${Date.now()}`;
  const filePayload = Buffer.from(fileContents, 'utf8');

  await pageA.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: filePayload
  });

  await expect(
    pageB.getByText(new RegExp(`${escapeRegExp(fileName)}\\s*\\[completed\\]`))
  ).toBeVisible({
    timeout: 20_000
  });
  await expect(pageB.locator(`a[download="${fileName}"]`)).toBeVisible();

  await Promise.all([contextA.close(), contextB.close()]);
});

test('peer reconnect restores remote peer visibility after forced ws close', async ({
  browser
}) => {
  const { contextA, contextB, pageA, pageB } = await setupConnectedPeers(browser);

  const closedSockets = await pageA.evaluate(() => {
    const forceClose = (window as typeof window & { __e2eForceCloseWebSockets?: () => number })
      .__e2eForceCloseWebSockets;
    return forceClose ? forceClose() : 0;
  });
  expect(closedSockets).toBeGreaterThan(0);

  await expect(pageA.getByText('Signaling status: connected')).toBeVisible({ timeout: 30_000 });
  await expect(pageA.getByText('Remote peers: 1')).toBeVisible({ timeout: 30_000 });
  await expect(pageB.getByText('Remote peers: 1')).toBeVisible({ timeout: 30_000 });

  await Promise.all([contextA.close(), contextB.close()]);
});

test('security verification flow updates peer fingerprint status', async ({ browser }) => {
  const { contextA, contextB, pageA } = await setupConnectedPeers(browser);

  const securitySection = pageA
    .locator('section')
    .filter({ has: pageA.getByRole('heading', { name: 'Security' }) });

  const peerStatusLine = securitySection
    .locator('p')
    .filter({ hasText: /Peer [a-f0-9]{8}:/i })
    .first();

  await expect(peerStatusLine).toContainText('[unverified]');

  await securitySection
    .getByRole('button', { name: /Mark peer .* as matched/i })
    .first()
    .click();
  await expect(peerStatusLine).toContainText('[matched]');

  await securitySection
    .getByRole('button', { name: /Mark peer .* as unmatched/i })
    .first()
    .click();
  await expect(peerStatusLine).toContainText('[unmatched]');

  await securitySection
    .getByRole('button', { name: /Clear verification for peer/i })
    .first()
    .click();
  await expect(peerStatusLine).toContainText('[unverified]');

  await Promise.all([contextA.close(), contextB.close()]);
});

test('corrupted file checksum is detected and both peers mark transfer as failed', async ({
  browser
}) => {
  const { contextA, contextB, pageA, pageB } = await setupConnectedPeers(browser);

  const corruptionEnabled = await pageA.evaluate(() => {
    const enableCorruption = (
      window as typeof window & { __e2eCorruptNextFileChecksum?: () => boolean }
    ).__e2eCorruptNextFileChecksum;
    return enableCorruption ? enableCorruption() : false;
  });
  expect(corruptionEnabled).toBe(true);

  const fileName = `e2e-corrupted-${Date.now()}.txt`;
  const filePayload = Buffer.from(`corrupt-me-${Date.now()}`, 'utf8');

  await pageA.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: filePayload
  });

  const failedLine = pageB
    .locator('p')
    .filter({ hasText: new RegExp(`${escapeRegExp(fileName)}\\s*\\[failed\\]`) })
    .first();
  await expect(failedLine).toBeVisible({ timeout: 20_000 });
  await expect(failedLine).toContainText('Checksum mismatch.');

  const senderFailedLine = pageA
    .locator('p')
    .filter({ hasText: new RegExp(`${escapeRegExp(fileName)}\\s*\\[failed\\]`) })
    .first();
  await expect(senderFailedLine).toBeVisible({ timeout: 20_000 });
  await expect(senderFailedLine).toContainText('Checksum mismatch.');

  await Promise.all([contextA.close(), contextB.close()]);
});

test('DataChannel messages use encrypted payload envelope for text and file transfer', async ({
  browser
}) => {
  const { contextA, contextB, pageA, pageB } = await setupConnectedPeers(browser);

  const messageText = `e2e-encrypted-${Date.now()}`;
  await pageA.getByPlaceholder('Type a message').fill(messageText);
  await pageA.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(pageB.getByText(messageText).first()).toBeVisible({ timeout: 10_000 });

  const fileName = `e2e-encrypted-${Date.now()}.txt`;
  const filePayload = Buffer.from(`enc-file-${Date.now()}`, 'utf8');
  await pageA.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: filePayload
  });
  await expect(
    pageB.getByText(new RegExp(`${escapeRegExp(fileName)}\\s*\\[completed\\]`))
  ).toBeVisible({
    timeout: 20_000
  });

  const payloadTypesA = await pageA.evaluate(() => {
    const getTypes = (window as typeof window & { __e2eGetSentPayloadTypes?: () => string[] })
      .__e2eGetSentPayloadTypes;
    return getTypes ? getTypes() : [];
  });

  expect(payloadTypesA.length).toBeGreaterThan(0);
  expect(payloadTypesA).toContain('encrypted');
  expect(payloadTypesA).not.toContain('text');
  expect(payloadTypesA).not.toContain('file-chunk');

  await Promise.all([contextA.close(), contextB.close()]);
});
