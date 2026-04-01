const BASE_URL = process.env.P2P_API_BASE_URL ?? 'http://127.0.0.1:3001';

async function expectOk(response, label) {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[smoke:http] ${label} failed: ${response.status} ${response.statusText} - ${text}`);
  }
}

async function main() {
  const startedAt = Date.now();

  const healthResponse = await fetch(`${BASE_URL}/health`);
  await expectOk(healthResponse, 'health');
  const healthText = await healthResponse.text();
  if (healthText.trim() !== 'ok') {
    throw new Error(`[smoke:http] health payload mismatch: expected "ok", got "${healthText}"`);
  }

  const loginResponse = await fetch(`${BASE_URL}/auth/dev-login?userId=smoke-user`);
  await expectOk(loginResponse, 'dev-login');
  const loginJson = await loginResponse.json();
  if (!loginJson?.accessToken || !loginJson?.refreshToken) {
    throw new Error('[smoke:http] dev-login response is missing accessToken or refreshToken.');
  }

  const refreshResponse = await fetch(
    `${BASE_URL}/auth/refresh?token=${encodeURIComponent(loginJson.refreshToken)}`
  );
  await expectOk(refreshResponse, 'refresh');
  const refreshJson = await refreshResponse.json();
  if (!refreshJson?.accessToken || !refreshJson?.refreshToken) {
    throw new Error('[smoke:http] refresh response is missing rotated tokens.');
  }
  if (refreshJson.refreshToken === loginJson.refreshToken) {
    throw new Error('[smoke:http] refresh token did not rotate.');
  }

  const turnResponse = await fetch(`${BASE_URL}/turn-credentials`, {
    headers: {
      Authorization: `Bearer ${loginJson.accessToken}`
    }
  });
  await expectOk(turnResponse, 'turn-credentials');
  const turnJson = await turnResponse.json();
  if (
    !turnJson?.username ||
    !turnJson?.credential ||
    !Array.isArray(turnJson?.urls) ||
    turnJson.urls.length === 0
  ) {
    throw new Error('[smoke:http] turn-credentials response is incomplete.');
  }

  const durationMs = Date.now() - startedAt;
  console.log('[smoke:http] PASS');
  console.log(`[smoke:http] base=${BASE_URL}`);
  console.log(`[smoke:http] duration=${durationMs}ms`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
