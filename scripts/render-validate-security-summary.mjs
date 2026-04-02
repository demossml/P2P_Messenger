import { readFile } from 'node:fs/promises';

function usage() {
  return 'Usage: node scripts/render-validate-security-summary.mjs <summary-json-path>';
}

async function main() {
  const summaryPath = process.argv[2];
  if (!summaryPath) {
    throw new Error(usage());
  }

  const raw = await readFile(summaryPath, 'utf8');
  const parsed = JSON.parse(raw);

  const steps = Array.isArray(parsed?.steps) ? parsed.steps : [];
  const outcome = typeof parsed?.outcome === 'string' ? parsed.outcome : 'unknown';
  const durationMs =
    typeof parsed?.durationMs === 'number' && Number.isFinite(parsed.durationMs)
      ? `${Math.max(0, Math.floor(parsed.durationMs))}ms`
      : 'n/a';
  const failedStep = typeof parsed?.failedStep === 'string' ? parsed.failedStep : '';
  const errorMessage = typeof parsed?.errorMessage === 'string' ? parsed.errorMessage : '';

  const lines = [];
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(`| Outcome | \`${String(outcome).toUpperCase()}\` |`);
  lines.push(`| Duration | \`${durationMs}\` |`);
  if (failedStep) {
    lines.push(`| Failed step | \`${failedStep}\` |`);
  }
  lines.push('');
  lines.push('| Step | Status | Duration |');
  lines.push('|---|---|---|');

  for (const step of steps) {
    const label = typeof step?.label === 'string' ? step.label : 'unknown';
    const statusRaw = typeof step?.status === 'string' ? step.status : 'unknown';
    const status = statusRaw.toUpperCase();
    const durationMs =
      typeof step?.durationMs === 'number' && Number.isFinite(step.durationMs)
        ? `${Math.max(0, Math.floor(step.durationMs))}ms`
        : 'n/a';

    lines.push(`| \`${label}\` | \`${status}\` | \`${durationMs}\` |`);
  }

  if (steps.length === 0) {
    lines.push('| `n/a` | `N/A` | `n/a` |');
  }

  if (failedStep) {
    lines.push('');
    lines.push(`Failed step: \`${failedStep}\``);
    if (errorMessage) {
      lines.push(`Reason: \`${errorMessage}\``);
    }
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
