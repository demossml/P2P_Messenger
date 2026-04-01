import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  console.error(`[k6:summary] ${message}`);
  process.exit(1);
}

function readSummary(filePath) {
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

function main() {
  const [, , summaryPathArg, profileArg = 'unknown'] = process.argv;
  if (!summaryPathArg) {
    fail('Usage: node scripts/load/render-k6-summary.mjs <summary.json> [profile]');
  }

  const summaryPath = path.resolve(summaryPathArg);
  const summary = readSummary(summaryPath);

  const httpReqFailed = metricValue(summary, 'http_req_failed', 'value');
  const wsUpgradeRate = metricValue(summary, 'ws_upgrade_success_rate', 'value');
  const wsConnectingP95 = metricValue(summary, 'ws_connecting', 'p(95)');
  const signalingSessionP95 = metricValue(summary, 'signaling_session_ms', 'p(95)');
  const httpReqDurationP95 = metricValue(summary, 'http_req_duration', 'p(95)');
  const iterations = metricValue(summary, 'iterations', 'count');

  const lines = [
    `### K6 Summary (${profileArg})`,
    '',
    `Source: \`${summaryPathArg}\``,
    '',
    '| Metric | Value |',
    '|---|---:|',
    `| iterations.count | ${fmtNumber(iterations, 0)} |`,
    `| http_req_failed.rate | ${fmtNumber(httpReqFailed, 6)} |`,
    `| ws_upgrade_success_rate | ${fmtNumber(wsUpgradeRate, 6)} |`,
    `| ws_connecting.p95 (ms) | ${fmtNumber(wsConnectingP95, 3)} |`,
    `| signaling_session_ms.p95 | ${fmtNumber(signalingSessionP95, 3)} |`,
    `| http_req_duration.p95 (ms) | ${fmtNumber(httpReqDurationP95, 3)} |`,
    ''
  ];

  process.stdout.write(lines.join('\n'));
}

main();
