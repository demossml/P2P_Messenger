import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ENV_FILE = process.env.P2P_ENV_FILE ?? '.env';
const CHECK_HEALTH = process.env.P2P_RELEASE_CHECK_HEALTH === '1';
const HEALTH_URL = process.env.P2P_RELEASE_HEALTH_URL ?? 'http://127.0.0.1:3001/health';

const REQUIRED_ENV_KEYS = [
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'TURN_SECRET',
  'REDIS_URL',
  'ALLOWED_ORIGIN',
  'TURN_HOST',
  'TURN_REALM'
];

const REQUIRED_SCRIPTS = ['validate:fast', 'validate:full', 'smoke:all', 'e2e:retry'];

function parseEnv(source) {
  const result = new Map();

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    result.set(key, value);
  }

  return result;
}

function looksLikePlaceholder(value) {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('changeme') ||
    normalized.includes('replace_me') ||
    normalized.includes('your_') ||
    normalized.includes('<secret>') ||
    normalized.includes('placeholder')
  );
}

async function checkEnv() {
  const envPath = resolve(process.cwd(), ENV_FILE);
  const source = await readFile(envPath, 'utf8');
  const env = parseEnv(source);

  const errors = [];
  const warnings = [];

  for (const key of REQUIRED_ENV_KEYS) {
    const value = env.get(key);
    if (!value) {
      errors.push(`Missing ${key} in ${ENV_FILE}`);
      continue;
    }

    if (looksLikePlaceholder(value)) {
      errors.push(`${key} looks like a placeholder value`);
    }
  }

  const jwtPrivate = env.get('JWT_PRIVATE_KEY');
  const jwtPublic = env.get('JWT_PUBLIC_KEY');
  if (jwtPrivate && !jwtPrivate.includes('BEGIN')) {
    warnings.push('JWT_PRIVATE_KEY does not look like a PEM block in .env.');
  }
  if (jwtPublic && !jwtPublic.includes('BEGIN')) {
    warnings.push('JWT_PUBLIC_KEY does not look like a PEM block in .env.');
  }

  return {
    envPath,
    errors,
    warnings
  };
}

async function checkScripts() {
  const packageJsonPath = resolve(process.cwd(), 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const scripts = packageJson?.scripts ?? {};
  const missing = REQUIRED_SCRIPTS.filter((name) => typeof scripts[name] !== 'string');

  return {
    missing
  };
}

async function checkHealth() {
  if (!CHECK_HEALTH) {
    return {
      skipped: true,
      ok: true,
      details: 'Health check skipped (set P2P_RELEASE_CHECK_HEALTH=1 to enable).'
    };
  }

  try {
    const response = await fetch(HEALTH_URL);
    const body = (await response.text()).trim();
    const ok = response.ok && body === 'ok';
    return {
      skipped: false,
      ok,
      details: ok
        ? `Health endpoint OK: ${HEALTH_URL}`
        : `Unexpected health response: status=${response.status}, body="${body}".`
    };
  } catch (error) {
    return {
      skipped: false,
      ok: false,
      details: `Health request failed: ${error instanceof Error ? error.message : String(error)}.`
    };
  }
}

function printSection(title) {
  console.log(`\n[release:readiness] ${title}`);
}

async function main() {
  const envResult = await checkEnv();
  const scriptsResult = await checkScripts();
  const healthResult = await checkHealth();

  printSection('Environment');
  console.log(`env file: ${envResult.envPath}`);
  if (envResult.errors.length === 0) {
    console.log('status: PASS');
  } else {
    console.log('status: FAIL');
    for (const error of envResult.errors) {
      console.log(`- ${error}`);
    }
  }
  for (const warning of envResult.warnings) {
    console.log(`- WARN: ${warning}`);
  }

  printSection('Required scripts');
  if (scriptsResult.missing.length === 0) {
    console.log('status: PASS');
  } else {
    console.log('status: FAIL');
    for (const missing of scriptsResult.missing) {
      console.log(`- Missing package.json script: ${missing}`);
    }
  }

  printSection('Health endpoint');
  console.log(`status: ${healthResult.ok ? 'PASS' : 'FAIL'}`);
  console.log(healthResult.details);
  if (!healthResult.ok && CHECK_HEALTH) {
    console.log('- Hint: start local runtime first (`pnpm dev:all`).');
    console.log(
      `- Hint: override target with P2P_RELEASE_HEALTH_URL if needed (current: ${HEALTH_URL}).`
    );
  }

  const hasErrors =
    envResult.errors.length > 0 || scriptsResult.missing.length > 0 || !healthResult.ok;

  if (hasErrors) {
    console.log('\n[release:readiness] FAIL');
    process.exit(1);
  }

  console.log('\n[release:readiness] PASS');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
