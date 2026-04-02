import { runWithRetry } from './retry-runner.mjs';

const MAX_ATTEMPTS = Number.parseInt(process.env.P2P_E2E_FULL_RETRY_ATTEMPTS ?? '2', 10);
const RETRY_DELAY_MS = Number.parseInt(process.env.P2P_E2E_FULL_RETRY_DELAY_MS ?? '3000', 10);

async function main() {
  await runWithRetry({
    label: 'e2e:retry',
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args: ['e2e'],
    maxAttempts: MAX_ATTEMPTS,
    retryDelayMs: RETRY_DELAY_MS
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
