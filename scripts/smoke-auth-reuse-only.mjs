const BASE_URL = process.env.P2P_API_BASE_URL ?? 'http://127.0.0.1:3001';

function parseCookieFromSetCookie(setCookieHeader, cookieName) {
  if (typeof setCookieHeader !== 'string' || setCookieHeader.length === 0) {
    return null;
  }

  const firstPair = setCookieHeader.split(';')[0]?.trim();
  if (!firstPair || !firstPair.startsWith(`${cookieName}=`)) {
    return null;
  }

  const rawValue = firstPair.slice(cookieName.length + 1);
  if (!rawValue) {
    return null;
  }

  return `${cookieName}=${rawValue}`;
}

async function expectStatus(response, expectedStatus, label) {
  if (response.status !== expectedStatus) {
    const text = await response.text();
    throw new Error(
      `[smoke:auth:reuse-only] ${label} failed: expected ${expectedStatus}, got ${response.status} ${response.statusText} - ${text}`
    );
  }
}

async function expectOk(response, label) {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `[smoke:auth:reuse-only] ${label} failed: ${response.status} ${response.statusText} - ${text}`
    );
  }
}

async function expectUnauthorizedCode(response, expectedCode, label) {
  await expectStatus(response, 401, label);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(
      `[smoke:auth:reuse-only] ${label} failed: expected JSON body with code=${expectedCode}, got content-type=${contentType} body=${text}`
    );
  }

  const body = await response.json();
  if (body?.code !== expectedCode) {
    throw new Error(
      `[smoke:auth:reuse-only] ${label} failed: expected code=${expectedCode}, got ${JSON.stringify(body)}`
    );
  }
}

async function main() {
  const startedAt = Date.now();
  const reuseUserId = `smoke-auth-reuse-only-${Date.now()}`;

  const loginResponse = await fetch(
    `${BASE_URL}/auth/dev-login?userId=${encodeURIComponent(reuseUserId)}`
  );
  await expectOk(loginResponse, 'login');
  const loginCookie = parseCookieFromSetCookie(
    loginResponse.headers.get('set-cookie'),
    'refreshToken'
  );
  if (!loginCookie) {
    throw new Error('[smoke:auth:reuse-only] login did not return refreshToken cookie.');
  }

  const firstRotateResponse = await fetch(`${BASE_URL}/auth/refresh`, {
    headers: { Cookie: loginCookie }
  });
  await expectOk(firstRotateResponse, 'first-rotate');
  const firstRotateCookie = parseCookieFromSetCookie(
    firstRotateResponse.headers.get('set-cookie'),
    'refreshToken'
  );
  if (!firstRotateCookie) {
    throw new Error(
      '[smoke:auth:reuse-only] first-rotate did not return rotated refreshToken cookie.'
    );
  }

  const reuseOldTokenResponse = await fetch(`${BASE_URL}/auth/refresh`, {
    headers: { Cookie: loginCookie }
  });
  await expectUnauthorizedCode(reuseOldTokenResponse, 'TOKEN_REUSE_DETECTED', 'reuse-old-token');

  const familyBlockedResponse = await fetch(`${BASE_URL}/auth/refresh`, {
    headers: { Cookie: firstRotateCookie }
  });
  await expectUnauthorizedCode(familyBlockedResponse, 'UNAUTHORIZED', 'family-blocked-after-reuse');

  const durationMs = Date.now() - startedAt;
  console.log('[smoke:auth:reuse-only] PASS');
  console.log(`[smoke:auth:reuse-only] base=${BASE_URL}`);
  console.log(`[smoke:auth:reuse-only] user=${reuseUserId}`);
  console.log(`[smoke:auth:reuse-only] duration=${durationMs}ms`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
