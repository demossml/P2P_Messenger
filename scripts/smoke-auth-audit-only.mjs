import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const BASE_URL = process.env.P2P_API_BASE_URL ?? 'http://127.0.0.1:3001';
const SUMMARY_PATH =
  process.env.P2P_AUTH_AUDIT_SMOKE_SUMMARY_PATH ??
  'artifacts/security/auth-audit-smoke-summary.json';

async function expectStatus(response, expectedStatus, label) {
  if (response.status !== expectedStatus) {
    const text = await response.text();
    throw new Error(
      `[smoke:auth:audit-only] ${label} failed: expected ${expectedStatus}, got ${response.status} ${response.statusText} - ${text}`
    );
  }
}

async function expectOk(response, label) {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `[smoke:auth:audit-only] ${label} failed: ${response.status} ${response.statusText} - ${text}`
    );
  }
}

async function main() {
  const startedAt = Date.now();
  const records = [];
  let failedStep = null;
  let errorMessage = null;
  const userId = `smoke-auth-audit-only-${Date.now()}`;

  try {
    const stepStartedAt = Date.now();
    const loginResponse = await fetch(
      `${BASE_URL}/auth/dev-login?userId=${encodeURIComponent(userId)}`
    );
    await expectOk(loginResponse, 'dev-login');
    const loginBody = await loginResponse.json();
    if (!loginBody?.accessToken || typeof loginBody.accessToken !== 'string') {
      throw new Error('[smoke:auth:audit-only] dev-login response is missing accessToken.');
    }

    const unauthorizedResponse = await fetch(`${BASE_URL}/auth/audit?limit=5`);
    await expectStatus(unauthorizedResponse, 401, 'audit-without-bearer');

    const invalidTokenResponse = await fetch(`${BASE_URL}/auth/audit?limit=5`, {
      headers: {
        Authorization: 'Bearer invalid-token'
      }
    });
    await expectStatus(invalidTokenResponse, 401, 'audit-with-invalid-bearer');

    const auditResponse = await fetch(`${BASE_URL}/auth/audit?limit=20`, {
      headers: {
        Authorization: `Bearer ${loginBody.accessToken}`
      }
    });
    await expectOk(auditResponse, 'audit-with-valid-bearer');
    const contentType = auditResponse.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new Error(
        `[smoke:auth:audit-only] audit response content type must be application/json, got ${contentType}`
      );
    }

    const auditBody = await auditResponse.json();
    if (
      typeof auditBody?.requestedBy !== 'string' ||
      !Array.isArray(auditBody?.entries) ||
      typeof auditBody?.count !== 'number'
    ) {
      throw new Error(
        `[smoke:auth:audit-only] audit response shape is invalid: ${JSON.stringify(auditBody)}`
      );
    }

    const foundOwnLoginEvent = auditBody.entries.some(
      (entry) =>
        entry &&
        entry.action === 'login' &&
        entry.details &&
        entry.details.userId === userId &&
        entry.details.result === 'success'
    );
    if (!foundOwnLoginEvent) {
      throw new Error(
        '[smoke:auth:audit-only] expected to find login success event for issued userId.'
      );
    }

    records.push({
      label: 'smoke:auth:audit-only',
      status: 'pass',
      durationMs: Date.now() - stepStartedAt
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
    console.log('[smoke:auth:audit-only] PASS');
    console.log(`[smoke:auth:audit-only] base=${BASE_URL}`);
    console.log(`[smoke:auth:audit-only] user=${userId}`);
    console.log(`[smoke:auth:audit-only] requestedBy=${auditBody.requestedBy}`);
    console.log(`[smoke:auth:audit-only] count=${auditBody.count}`);
    console.log(`[smoke:auth:audit-only] duration=${durationMs}ms`);
  } catch (error) {
    failedStep = 'smoke:auth:audit-only';
    errorMessage = error instanceof Error ? error.message : String(error);
    records.push({
      label: 'smoke:auth:audit-only',
      status: 'fail',
      durationMs: Date.now() - startedAt
    });
    await writeSummary({
      outcome: 'failure',
      startedAt,
      finishedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      records,
      failedStep,
      errorMessage
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
