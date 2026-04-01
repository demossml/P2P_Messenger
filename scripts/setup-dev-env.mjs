import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const envExamplePath = resolve(root, '.env.example');
const envPath = resolve(root, '.env');

function parseEnvFile(content) {
  const map = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalIndex = line.indexOf('=');
    if (equalIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalIndex).trim();
    const value = line.slice(equalIndex + 1);
    map.set(key, value);
  }
  return map;
}

function toEnvString(value) {
  return value.replace(/\r?\n/g, '\\n');
}

function isPlaceholder(value) {
  return (
    !value ||
    value.startsWith('replace-with-') ||
    value === 'turn.yourdomain.com' ||
    value === '-----BEGIN'
  );
}

function ensureRsaKeys(env) {
  const currentPublic = env.get('JWT_PUBLIC_KEY');
  const currentPrivate = env.get('JWT_PRIVATE_KEY');

  const hasValidKeys =
    currentPublic &&
    currentPrivate &&
    !isPlaceholder(currentPublic) &&
    !isPlaceholder(currentPrivate) &&
    currentPublic.includes('BEGIN PUBLIC KEY') &&
    currentPrivate.includes('BEGIN PRIVATE KEY');

  if (hasValidKeys) {
    return false;
  }

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  env.set('JWT_PUBLIC_KEY', toEnvString(publicKey));
  env.set('JWT_PRIVATE_KEY', toEnvString(privateKey));
  return true;
}

function ensureTurnSecret(env) {
  const current = env.get('TURN_SECRET');
  const hasValidSecret = current && !isPlaceholder(current) && current.length >= 32;

  if (hasValidSecret) {
    return false;
  }

  env.set('TURN_SECRET', randomBytes(32).toString('hex'));
  return true;
}

if (!existsSync(envExamplePath)) {
  console.error('[dev:setup] .env.example is missing.');
  process.exit(1);
}

const base = parseEnvFile(readFileSync(envExamplePath, 'utf8'));
const current = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, 'utf8')) : new Map();

for (const [key, value] of current.entries()) {
  base.set(key, value);
}

const generatedKeys = ensureRsaKeys(base);
const generatedTurnSecret = ensureTurnSecret(base);

if (!base.get('ALLOWED_ORIGIN')) {
  base.set('ALLOWED_ORIGIN', 'http://localhost:5173');
}

const orderedEntries = Array.from(base.entries()).sort(([a], [b]) => a.localeCompare(b));
const output = orderedEntries.map(([key, value]) => `${key}=${value}`).join('\n') + '\n';

writeFileSync(envPath, output, 'utf8');

console.log('[dev:setup] .env is ready.');
if (generatedKeys) {
  console.log('[dev:setup] Generated JWT RSA key pair.');
}
if (generatedTurnSecret) {
  console.log('[dev:setup] Generated TURN_SECRET.');
}
