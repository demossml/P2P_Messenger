import { spawn } from 'node:child_process';

const STEPS = [
  { label: 'smoke:minimal:retry', args: ['smoke:minimal:retry'] },
  { label: 'e2e:minimal:retry', args: ['e2e:minimal:retry'] }
];

function hintsForStep(stepLabel) {
  if (stepLabel.startsWith('smoke:')) {
    return [
      'Start local runtime first: `pnpm dev:all`.',
      'Check signaling health: `curl -fsS http://127.0.0.1:3001/health`.',
      'If ports are busy, stop stale processes/docker services and retry.'
    ];
  }

  if (stepLabel.startsWith('e2e:')) {
    return [
      'Install browser once: `pnpm exec playwright install chromium`.',
      'If app is already running, try local mode: `pnpm e2e:minimal:local`.',
      'Review Playwright artifacts in `test-results/` for exact failure context.'
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
  for (const step of STEPS) {
    console.log(`[validate:fast] running ${step.label}`);
    try {
      await runPnpmStep(step.args);
    } catch (error) {
      const hints = hintsForStep(step.label);
      if (hints.length > 0) {
        console.error(`[validate:fast] hints for ${step.label}:`);
        for (const hint of hints) {
          console.error(`- ${hint}`);
        }
      }
      throw new Error(
        `[validate:fast] step ${step.label} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const durationMs = Date.now() - startedAt;
  console.log(`[validate:fast] PASS duration=${durationMs}ms`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
