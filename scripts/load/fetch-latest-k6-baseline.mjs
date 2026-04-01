import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function fail(message) {
  console.error(`[k6:baseline] ${message}`);
  process.exit(1);
}

function info(message) {
  console.log(`[k6:baseline] ${message}`);
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} for ${url}: ${body}`);
  }

  return response.json();
}

async function downloadArtifact(url, token, outputZipPath) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} for ${url}: ${body}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputZipPath, bytes);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function unzipArchive(zipPath, outputDir) {
  const result = spawnSync('unzip', ['-o', zipPath, '-d', outputDir], {
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    fail(`Failed to unzip archive ${zipPath}.`);
  }
}

function findFirstJsonFile(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = findFirstJsonFile(fullPath);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.json')) {
      return fullPath;
    }
  }

  return null;
}

async function main() {
  const [, , profileArg, outputPathArg] = process.argv;
  const profile = profileArg === 'stress' ? 'stress' : 'quick';
  const outputPath = outputPathArg ? path.resolve(outputPathArg) : null;

  if (!outputPath) {
    fail('Usage: node scripts/load/fetch-latest-k6-baseline.mjs <quick|stress> <outputPath>');
  }

  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const currentRunId = Number(process.env.GITHUB_RUN_ID || 0);
  if (!token || !repository) {
    fail('Missing required env: GITHUB_TOKEN or GITHUB_REPOSITORY.');
  }

  const [owner, repo] = repository.split('/');
  if (!owner || !repo) {
    fail(`Invalid GITHUB_REPOSITORY value: ${repository}`);
  }

  const workflowFile = 'k6-signaling.yml';
  const artifactName = `k6-signaling-${profile}-summary`;

  info(`Searching latest successful baseline for profile=${profile} artifact=${artifactName}`);

  const runsResponse = await fetchJson(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/runs?branch=main&status=success&per_page=30`,
    token
  );
  const runs = Array.isArray(runsResponse.workflow_runs) ? runsResponse.workflow_runs : [];

  for (const run of runs) {
    const runId = Number(run.id);
    if (!Number.isFinite(runId) || runId <= 0) {
      continue;
    }
    if (currentRunId > 0 && runId === currentRunId) {
      continue;
    }

    const artifactsResponse = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/artifacts?per_page=100`,
      token
    );
    const artifacts = Array.isArray(artifactsResponse.artifacts) ? artifactsResponse.artifacts : [];
    const artifact = artifacts.find((candidate) => candidate?.name === artifactName && !candidate.expired);
    if (!artifact) {
      continue;
    }

    const tempDir = path.resolve('artifacts', 'k6', 'baseline-tmp');
    ensureDir(tempDir);
    const zipPath = path.join(tempDir, `artifact-${runId}.zip`);

    info(`Downloading artifact from run=${runId}`);
    await downloadArtifact(
      `https://api.github.com/repos/${owner}/${repo}/actions/artifacts/${artifact.id}/zip`,
      token,
      zipPath
    );

    const unzipDir = path.join(tempDir, `unzipped-${runId}`);
    ensureDir(unzipDir);
    unzipArchive(zipPath, unzipDir);

    const jsonPath = findFirstJsonFile(unzipDir);
    if (!jsonPath) {
      info(`No JSON found in artifact for run=${runId}, continuing search.`);
      continue;
    }

    ensureDir(path.dirname(outputPath));
    fs.copyFileSync(jsonPath, outputPath);
    info(`Baseline saved to ${outputPath}`);
    return;
  }

  info('No suitable previous baseline artifact found.');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
