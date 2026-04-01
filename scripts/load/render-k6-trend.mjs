import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  console.error(`[k6:trend] ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    fail(
      `Cannot read summary file "${filePath}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function metricValue(summary, metricName, valueKey) {
  const metric = summary?.metrics?.[metricName];
  if (!metric || typeof metric !== 'object') {
    return null;
  }

  const direct = metric[valueKey];
  if (typeof direct === 'number' && Number.isFinite(direct)) {
    return direct;
  }

  if (metric.values && typeof metric.values === 'object') {
    const nested = metric.values[valueKey];
    if (typeof nested === 'number' && Number.isFinite(nested)) {
      return nested;
    }
  }

  return null;
}

function fmtNumber(value, digits = 3) {
  if (value === null) {
    return 'n/a';
  }
  return value.toFixed(digits);
}

function fmtDelta(base, current, digits = 3) {
  if (base === null || current === null) {
    return 'n/a';
  }

  const delta = current - base;
  const sign = delta > 0 ? '+' : '';
  const ratio = base === 0 ? null : (delta / base) * 100;
  const ratioText = ratio === null ? 'n/a' : `${ratio > 0 ? '+' : ''}${ratio.toFixed(2)}%`;
  return `${sign}${delta.toFixed(digits)} (${ratioText})`;
}

function trendMarker(base, current, lowerIsBetter) {
  if (base === null || current === null) {
    return 'n/a';
  }
  if (current === base) {
    return 'stable';
  }
  const improved = lowerIsBetter ? current < base : current > base;
  return improved ? 'improved' : 'regressed';
}

function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const [currentPathArg, baselinePathArg, profileArg = 'unknown'] = args;
  if (!currentPathArg) {
    fail('Usage: node scripts/load/render-k6-trend.mjs <current.json> [baseline.json] [profile]');
  }

  const currentPath = path.resolve(currentPathArg);
  const baselinePath = baselinePathArg ? path.resolve(baselinePathArg) : null;
  const current = readJson(currentPath);
  const baseline = baselinePath && fs.existsSync(baselinePath) ? readJson(baselinePath) : null;

  const metrics = [
    { name: 'http_req_failed', key: 'value', label: 'http_req_failed.rate', lowerIsBetter: true, digits: 6 },
    {
      name: 'ws_upgrade_success_rate',
      key: 'value',
      label: 'ws_upgrade_success_rate',
      lowerIsBetter: false,
      digits: 6
    },
    { name: 'ws_connecting', key: 'p(95)', label: 'ws_connecting.p95 (ms)', lowerIsBetter: true, digits: 3 },
    {
      name: 'signaling_session_ms',
      key: 'p(95)',
      label: 'signaling_session_ms.p95',
      lowerIsBetter: true,
      digits: 3
    },
    {
      name: 'http_req_duration',
      key: 'p(95)',
      label: 'http_req_duration.p95 (ms)',
      lowerIsBetter: true,
      digits: 3
    }
  ];

  const lines = [];
  lines.push(`### K6 Trend (${profileArg})`);
  lines.push('');
  lines.push(`Current: \`${currentPathArg}\``);
  lines.push(`Baseline: ${baseline ? `\`${baselinePathArg}\`` : 'not found (trend skipped)'}`);
  lines.push('');
  lines.push('| Metric | Baseline | Current | Delta | Trend |');
  lines.push('|---|---:|---:|---:|---|');

  for (const metric of metrics) {
    const currentValue = metricValue(current, metric.name, metric.key);
    const baselineValue = baseline ? metricValue(baseline, metric.name, metric.key) : null;
    lines.push(
      `| ${metric.label} | ${fmtNumber(baselineValue, metric.digits)} | ${fmtNumber(
        currentValue,
        metric.digits
      )} | ${fmtDelta(baselineValue, currentValue, metric.digits)} | ${trendMarker(
        baselineValue,
        currentValue,
        metric.lowerIsBetter
      )} |`
    );
  }

  lines.push('');
  process.stdout.write(lines.join('\n'));
}

main();
