import { runWithRetry } from './retry-runner.mjs';

const MAX_ATTEMPTS = Number.parseInt(process.env.P2P_SMOKE_HTTP_SECURITY_RETRY_ATTEMPTS ?? '2', 10);
const RETRY_DELAY_MS = Number.parseInt(
  process.env.P2P_SMOKE_HTTP_SECURITY_RETRY_DELAY_MS ?? '1500',
  10
);

async function main() {
  await runWithRetry({
    label: 'smoke:http:security:retry',
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args: ['smoke:http:security'],
    maxAttempts: MAX_ATTEMPTS,
    retryDelayMs: RETRY_DELAY_MS
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
