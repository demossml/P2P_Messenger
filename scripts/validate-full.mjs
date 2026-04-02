import { spawn } from 'node:child_process';

const STEPS = [
  { label: 'smoke:all', args: ['smoke:all'] },
  { label: 'e2e:retry', args: ['e2e:retry'] },
  { label: 'lint', args: ['lint'] },
  { label: 'typecheck', args: ['typecheck'] }
];

function hintsForStep(stepLabel) {
  if (stepLabel.startsWith('smoke:')) {
    return [
      'Start local runtime first: `pnpm dev:all`.',
      'Check signaling health: `curl -fsS http://127.0.0.1:3001/health`.',
      'Run narrower check to isolate: `pnpm smoke:ws:negative`.'
    ];
  }

  if (stepLabel.startsWith('e2e:')) {
    return [
      'Install browser once: `pnpm exec playwright install chromium`.',
      'Run minimal suite to isolate: `pnpm e2e:minimal:retry`.',
      'Inspect `test-results/` for failure traces and page snapshots.'
    ];
  }

  if (stepLabel === 'lint') {
    return [
      'Run package-local lint to isolate scope (example: `pnpm --filter @p2p/server lint`).',
      'Apply formatting if needed: `pnpm format`.'
    ];
  }

  if (stepLabel === 'typecheck') {
    return [
      'Run package-local typecheck to isolate scope (example: `pnpm --filter @p2p/server typecheck`).',
      'Check recent schema/test edits for missing type narrowing.'
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
    console.log(`[validate:full] running ${step.label}`);
    try {
      await runPnpmStep(step.args);
    } catch (error) {
      const hints = hintsForStep(step.label);
      if (hints.length > 0) {
        console.error(`[validate:full] hints for ${step.label}:`);
        for (const hint of hints) {
          console.error(`- ${hint}`);
        }
      }
      throw new Error(
        `[validate:full] step ${step.label} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const durationMs = Date.now() - startedAt;
  console.log(`[validate:full] PASS duration=${durationMs}ms`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
