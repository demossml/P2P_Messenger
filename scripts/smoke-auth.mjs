import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const STEPS = [
  { label: 'smoke:auth:lifecycle-only', args: ['smoke:auth:lifecycle-only'] },
  { label: 'smoke:auth:reuse-only', args: ['smoke:auth:reuse-only'] }
];

const SUMMARY_PATH =
  process.env.P2P_AUTH_SMOKE_SUMMARY_PATH ?? 'artifacts/security/auth-smoke-summary.json';

function printSummary(records) {
  console.log('[smoke:auth] summary:');
  for (const record of records) {
    console.log(
      `[smoke:auth] - ${record.label}: ${record.status.toUpperCase()} (${record.durationMs}ms)`
    );
  }
}

function hintsForStep(stepLabel) {
  if (stepLabel === 'smoke:auth:lifecycle-only') {
    return [
      'Start local runtime first: `pnpm dev:all`.',
      'Re-run lifecycle-only path: `pnpm smoke:auth:lifecycle-only`.',
      'Verify auth endpoints: `/auth/dev-login`, `/auth/refresh`, `/auth/logout`.'
    ];
  }

  if (stepLabel === 'smoke:auth:reuse-only') {
    return [
      'Re-run reuse-only path: `pnpm smoke:auth:reuse-only`.',
      'Confirm refresh rotation and family revoke behavior in server logs.',
      'Verify health endpoint: `curl -fsS http://127.0.0.1:3001/health`.'
    ];
  }

  return [];
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
    console.log(`[smoke:auth] running ${step.label}`);
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
        console.error(`[smoke:auth] hints for ${step.label}:`);
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
    throw new Error(`[smoke:auth] step ${failedStep} failed: ${errorMessage ?? 'unknown error'}`);
  }

  console.log(`[smoke:auth] PASS duration=${durationMs}ms`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
