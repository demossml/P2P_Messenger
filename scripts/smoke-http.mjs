import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const BASE_URL = process.env.P2P_API_BASE_URL ?? 'http://127.0.0.1:3001';
const SUMMARY_PATH =
  process.env.P2P_SMOKE_HTTP_SECURITY_SUMMARY_PATH ??
  'artifacts/security/smoke-http-security-summary.json';

async function expectOk(response, label) {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `[smoke:http] ${label} failed: ${response.status} ${response.statusText} - ${text}`
    );
  }
}

function expectHeaderIncludes(response, headerName, expectedPart, label) {
  const actual = response.headers.get(headerName);
  if (!actual || !actual.includes(expectedPart)) {
    throw new Error(
      `[smoke:http] ${label} missing/invalid ${headerName}: expected to include "${expectedPart}", got "${actual}"`
    );
  }
}

function expectSecurityHeaders(response, label) {
  expectHeaderIncludes(response, 'x-content-type-options', 'nosniff', label);
  expectHeaderIncludes(response, 'x-frame-options', 'DENY', label);
  expectHeaderIncludes(response, 'referrer-policy', 'no-referrer', label);
  expectHeaderIncludes(
    response,
    'permissions-policy',
    'camera=(), microphone=(), geolocation=(), browsing-topics=()',
    label
  );
  expectHeaderIncludes(
    response,
    'content-security-policy',
    "default-src 'self'; connect-src 'self' ws: wss: http: https:; frame-ancestors 'none'",
    label
  );
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

  try {
    let loginJson = null;
    await runStep('health', async () => {
      const healthResponse = await fetch(`${BASE_URL}/health`);
      await expectOk(healthResponse, 'health');
      const healthText = await healthResponse.text();
      if (healthText.trim() !== 'ok') {
        throw new Error(`[smoke:http] health payload mismatch: expected "ok", got "${healthText}"`);
      }
    });

    await runStep('dev-login', async () => {
      const loginResponse = await fetch(`${BASE_URL}/auth/dev-login?userId=smoke-user`);
      await expectOk(loginResponse, 'dev-login');
      expectSecurityHeaders(loginResponse, 'dev-login');
      loginJson = await loginResponse.json();
      if (!loginJson?.accessToken || !loginJson?.refreshToken) {
        throw new Error('[smoke:http] dev-login response is missing accessToken or refreshToken.');
      }
    });

    await runStep('refresh', async () => {
      if (!loginJson?.refreshToken) {
        throw new Error('[smoke:http] missing refresh token from login step.');
      }

      const refreshResponse = await fetch(
        `${BASE_URL}/auth/refresh?token=${encodeURIComponent(loginJson.refreshToken)}`
      );
      await expectOk(refreshResponse, 'refresh');
      expectSecurityHeaders(refreshResponse, 'refresh');
      const refreshJson = await refreshResponse.json();
      if (!refreshJson?.accessToken || !refreshJson?.refreshToken) {
        throw new Error('[smoke:http] refresh response is missing rotated tokens.');
      }
      if (refreshJson.refreshToken === loginJson.refreshToken) {
        throw new Error('[smoke:http] refresh token did not rotate.');
      }
    });

    await runStep('turn-credentials', async () => {
      if (!loginJson?.accessToken) {
        throw new Error('[smoke:http] missing access token from login step.');
      }

      const turnResponse = await fetch(`${BASE_URL}/turn-credentials`, {
        headers: {
          Authorization: `Bearer ${loginJson.accessToken}`
        }
      });
      await expectOk(turnResponse, 'turn-credentials');
      expectSecurityHeaders(turnResponse, 'turn-credentials');
      const turnJson = await turnResponse.json();
      if (
        !turnJson?.username ||
        !turnJson?.credential ||
        !Array.isArray(turnJson?.urls) ||
        turnJson.urls.length === 0
      ) {
        throw new Error('[smoke:http] turn-credentials response is incomplete.');
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
    console.log('[smoke:http] PASS');
    console.log(`[smoke:http] base=${BASE_URL}`);
    console.log(`[smoke:http] duration=${durationMs}ms`);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    await writeSummary({
      outcome: 'failure',
      startedAt,
      finishedAt: Date.now(),
      durationMs,
      records,
      failedStep: failedStep ?? 'smoke:http',
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
