import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const STEPS = [
  { label: 'smoke:http:security:retry', args: ['smoke:http:security:retry'] },
  { label: 'smoke:auth:reuse-only:retry', args: ['smoke:auth:reuse-only:retry'] },
  { label: 'smoke:auth:audit-only:retry', args: ['smoke:auth:audit-only:retry'] },
  { label: 'smoke:ws:negative:retry', args: ['smoke:ws:negative:retry'] }
];
const SUMMARY_PATH =
  process.env.P2P_VALIDATE_SECURITY_SUMMARY_PATH ??
  'artifacts/security/validate-security-summary.json';

function printSummary(records) {
  console.log('[validate:security] summary:');
  for (const record of records) {
    const duration = `${record.durationMs}ms`;
    console.log(
      `[validate:security] - ${record.label}: ${record.status.toUpperCase()} (${duration})`
    );
  }
}

async function writeSummaryFile({
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

function hintsForStep(stepLabel) {
  if (stepLabel === 'smoke:http:security:retry') {
    return [
      'Start local runtime first: `pnpm dev:all`.',
      'Verify health endpoint: `curl -fsS http://127.0.0.1:3001/health`.',
      'Re-run just HTTP security checks with retry: `pnpm smoke:http:security:retry`.',
      'Run non-retry variant for strict debugging: `pnpm smoke:http:security`.'
    ];
  }

  if (stepLabel === 'smoke:auth:reuse-only:retry') {
    return [
      'Re-run auth reuse checks with retry: `pnpm smoke:auth:reuse-only:retry`.',
      'Run non-retry variant for strict debugging: `pnpm smoke:auth:reuse-only`.',
      'If needed, run full auth smoke too: `pnpm smoke:auth`.',
      'Verify auth endpoints locally: `/auth/dev-login`, `/auth/refresh`, `/auth/logout`.'
    ];
  }

  if (stepLabel === 'smoke:auth:audit-only:retry') {
    return [
      'Re-run auth audit checks with retry: `pnpm smoke:auth:audit-only:retry`.',
      'Run non-retry variant for strict debugging: `pnpm smoke:auth:audit-only`.',
      'Verify protected endpoint with bearer token: `GET /auth/audit?limit=20`.',
      'Ensure auth audit writes are enabled and Redis is reachable.'
    ];
  }

  if (stepLabel === 'smoke:ws:negative:retry') {
    return [
      'Re-run WS negative checks with retry: `pnpm smoke:ws:negative:retry`.',
      'Run non-retry variant for strict debugging: `pnpm smoke:ws:negative`.',
      'Re-run strict WS suite if needed: `pnpm smoke:ws:strict`.',
      'Confirm signaling health: `curl -fsS http://127.0.0.1:3001/health`.'
    ];
  }

  return [];
}

function runPnpmStep(args) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const child = spawn(command, args, { stdio: 'inherit' });

    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal) {
        reject(new Error(`terminated by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`exit code ${code ?? 'unknown'}`));
        return;
      }
      resolve();
    });
  });
}

async function main() {
  const startedAt = Date.now();
  const records = [];
  let failedStep = null;
  let errorMessage = null;
  for (const step of STEPS) {
    console.log(`[validate:security] running ${step.label}`);
    const stepStartedAt = Date.now();
    try {
      await runPnpmStep(step.args);
      records.push({
        label: step.label,
        status: 'pass',
        durationMs: Date.now() - stepStartedAt
      });
    } catch (error) {
      failedStep = step.label;
      errorMessage = error instanceof Error ? error.message : String(error);
      records.push({
        label: step.label,
        status: 'fail',
        durationMs: Date.now() - stepStartedAt
      });
      printSummary(records);
      const hints = hintsForStep(step.label);
      if (hints.length > 0) {
        console.error(`[validate:security] hints for ${step.label}:`);
        for (const hint of hints) {
          console.error(`- ${hint}`);
        }
      }
      break;
    }
  }

  const finishedAt = Date.now();
  const durationMs = finishedAt - startedAt;
  const outcome = failedStep ? 'failure' : 'success';
  await writeSummaryFile({
    outcome,
    startedAt,
    finishedAt,
    durationMs,
    records,
    failedStep,
    errorMessage
  });
  printSummary(records);
  if (failedStep) {
    throw new Error(
      `[validate:security] step ${failedStep} failed: ${errorMessage ?? 'unknown error'}`
    );
  }

  console.log(`[validate:security] PASS duration=${durationMs}ms`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
