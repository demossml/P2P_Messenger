import { spawn } from 'node:child_process';

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit'
    });

    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal) {
        resolve({ ok: false, code: null, signal });
        return;
      }

      resolve({ ok: code === 0, code: code ?? 1, signal: null });
    });

    process.once('SIGINT', () => {
      child.kill('SIGINT');
    });

    process.once('SIGTERM', () => {
      child.kill('SIGTERM');
    });
  });
}

export async function runWithRetry({ label, command, args, maxAttempts, retryDelayMs }) {
  if (!Number.isFinite(maxAttempts) || maxAttempts < 1) {
    throw new Error(`[${label}] maxAttempts must be >= 1.`);
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new Error(`[${label}] retryDelayMs must be >= 0.`);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`[${label}] attempt=${attempt}/${maxAttempts}`);
    const result = await runCommand(command, args);
    if (result.ok) {
      console.log(`[${label}] PASS after ${attempt} attempt(s).`);
      return;
    }

    const reason =
      result.signal !== null ? `signal=${result.signal}` : `exitCode=${result.code ?? 'unknown'}`;
    console.warn(`[${label}] attempt ${attempt} failed (${reason}).`);

    if (attempt < maxAttempts) {
      console.log(`[${label}] waiting ${retryDelayMs}ms before retry.`);
      await wait(retryDelayMs);
    }
  }

  throw new Error(`[${label}] failed after ${maxAttempts} attempt(s).`);
}
