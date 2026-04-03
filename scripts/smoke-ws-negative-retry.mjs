import { runWithRetry } from './retry-runner.mjs';

const MAX_ATTEMPTS = Number.parseInt(process.env.P2P_SMOKE_WS_NEGATIVE_RETRY_ATTEMPTS ?? '2', 10);
const RETRY_DELAY_MS = Number.parseInt(
  process.env.P2P_SMOKE_WS_NEGATIVE_RETRY_DELAY_MS ?? '1500',
  10
);

async function main() {
  await runWithRetry({
    label: 'smoke:ws:negative:retry',
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args: ['smoke:ws:negative'],
    maxAttempts: MAX_ATTEMPTS,
    retryDelayMs: RETRY_DELAY_MS
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
