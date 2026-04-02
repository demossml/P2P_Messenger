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
      `[smoke:auth:lifecycle-only] ${label} failed: expected ${expectedStatus}, got ${response.status} ${response.statusText} - ${text}`
    );
  }
}

async function expectOk(response, label) {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `[smoke:auth:lifecycle-only] ${label} failed: ${response.status} ${response.statusText} - ${text}`
    );
  }
}

async function expectUnauthorizedCode(response, expectedCode, label) {
  await expectStatus(response, 401, label);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(
      `[smoke:auth:lifecycle-only] ${label} failed: expected JSON body with code=${expectedCode}, got content-type=${contentType} body=${text}`
    );
  }

  const body = await response.json();
  if (body?.code !== expectedCode) {
    throw new Error(
      `[smoke:auth:lifecycle-only] ${label} failed: expected code=${expectedCode}, got ${JSON.stringify(body)}`
    );
  }
}

async function main() {
  const startedAt = Date.now();
  const userId = `smoke-auth-lifecycle-only-${Date.now()}`;

  const loginResponse = await fetch(
    `${BASE_URL}/auth/dev-login?userId=${encodeURIComponent(userId)}`
  );
  await expectOk(loginResponse, 'dev-login');
  const loginBody = await loginResponse.json();
  if (!loginBody?.accessToken || !loginBody?.refreshToken) {
    throw new Error(
      '[smoke:auth:lifecycle-only] dev-login response is missing accessToken or refreshToken.'
    );
  }

  const loginCookie = parseCookieFromSetCookie(
    loginResponse.headers.get('set-cookie'),
    'refreshToken'
  );
  if (!loginCookie) {
    throw new Error('[smoke:auth:lifecycle-only] dev-login did not return refreshToken cookie.');
  }

  const refreshResponse = await fetch(`${BASE_URL}/auth/refresh`, {
    headers: { Cookie: loginCookie }
  });
  await expectOk(refreshResponse, 'refresh-with-cookie');
  const refreshBody = await refreshResponse.json();
  if (!refreshBody?.accessToken || !refreshBody?.refreshToken) {
    throw new Error('[smoke:auth:lifecycle-only] refresh response is missing rotated tokens.');
  }
  if (refreshBody.refreshToken === loginBody.refreshToken) {
    throw new Error('[smoke:auth:lifecycle-only] refresh token was not rotated.');
  }

  const rotatedCookie = parseCookieFromSetCookie(
    refreshResponse.headers.get('set-cookie'),
    'refreshToken'
  );
  if (!rotatedCookie) {
    throw new Error(
      '[smoke:auth:lifecycle-only] refresh did not return rotated refreshToken cookie.'
    );
  }

  const logoutResponse = await fetch(`${BASE_URL}/auth/logout`, {
    headers: { Cookie: rotatedCookie }
  });
  await expectStatus(logoutResponse, 204, 'logout-with-cookie');

  const refreshAfterLogoutResponse = await fetch(`${BASE_URL}/auth/refresh`, {
    headers: { Cookie: rotatedCookie }
  });
  await expectUnauthorizedCode(refreshAfterLogoutResponse, 'UNAUTHORIZED', 'refresh-after-logout');

  const durationMs = Date.now() - startedAt;
  console.log('[smoke:auth:lifecycle-only] PASS');
  console.log(`[smoke:auth:lifecycle-only] base=${BASE_URL}`);
  console.log(`[smoke:auth:lifecycle-only] user=${userId}`);
  console.log(`[smoke:auth:lifecycle-only] duration=${durationMs}ms`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
