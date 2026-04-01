import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  console.error(`[k6:compare] ${message}`);
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

  const directValue = metric[valueKey];
  if (typeof directValue === 'number' && Number.isFinite(directValue)) {
    return directValue;
  }

  if (metric.values && typeof metric.values === 'object') {
    const nestedValue = metric.values[valueKey];
    if (typeof nestedValue === 'number' && Number.isFinite(nestedValue)) {
      return nestedValue;
    }
  }

  return null;
}

function formatDelta(base, candidate, unit = '') {
  const delta = candidate - base;
  const sign = delta > 0 ? '+' : '';
  const ratio = base === 0 ? null : (delta / base) * 100;
  const ratioText = ratio === null ? 'n/a' : `${ratio > 0 ? '+' : ''}${ratio.toFixed(2)}%`;
  return `${sign}${delta.toFixed(3)}${unit} (${ratioText})`;
}

function printRow(label, base, candidate, lowerIsBetter = true, unit = '') {
  if (base === null || candidate === null) {
    console.log(`${label}: missing metric`);
    return { regressed: false };
  }

  const isRegression = lowerIsBetter ? candidate > base : candidate < base;
  const marker = isRegression ? 'REGRESSION' : 'ok';
  console.log(
    `${label}: base=${base.toFixed(3)}${unit} candidate=${candidate.toFixed(3)}${unit} delta=${formatDelta(
      base,
      candidate,
      unit
    )} -> ${marker}`
  );

  return { regressed: isRegression };
}

function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const [basePathArg, candidatePathArg] = args;
  if (!basePathArg || !candidatePathArg) {
    fail(
      'Usage: node scripts/load/compare-k6-summary.mjs <base-summary.json> <candidate-summary.json>'
    );
  }

  const basePath = path.resolve(process.cwd(), basePathArg);
  const candidatePath = path.resolve(process.cwd(), candidatePathArg);

  const base = readJson(basePath);
  const candidate = readJson(candidatePath);

  console.log(`[k6:compare] base=${basePath}`);
  console.log(`[k6:compare] candidate=${candidatePath}`);

  const checks = [];
  checks.push(
    printRow(
      'http_req_failed.rate',
      metricValue(base, 'http_req_failed', 'value'),
      metricValue(candidate, 'http_req_failed', 'value'),
      true
    )
  );
  checks.push(
    printRow(
      'ws_upgrade_success_rate.rate',
      metricValue(base, 'ws_upgrade_success_rate', 'value'),
      metricValue(candidate, 'ws_upgrade_success_rate', 'value'),
      false
    )
  );
  checks.push(
    printRow(
      'ws_connecting.p(95)',
      metricValue(base, 'ws_connecting', 'p(95)'),
      metricValue(candidate, 'ws_connecting', 'p(95)'),
      true
    )
  );
  checks.push(
    printRow(
      'signaling_session_ms.p(95)',
      metricValue(base, 'signaling_session_ms', 'p(95)'),
      metricValue(candidate, 'signaling_session_ms', 'p(95)'),
      true
    )
  );

  const regressions = checks.filter((entry) => entry.regressed).length;
  if (regressions > 0) {
    fail(`Detected ${regressions} regression(s).`);
  }

  console.log('[k6:compare] PASS');
}

main();
