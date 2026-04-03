# P2P Messenger

Monorepo bootstrap for P2P Messenger.

## Stack

- pnpm workspaces
- Turborepo
- TypeScript strict mode
- ESLint + Prettier
- Husky + lint-staged + commitlint

## Quick start

1. Copy environment:
   - `cp .env.example .env`
2. Put valid RSA keys into `.env`:
   - `JWT_PRIVATE_KEY` (PKCS#8 PEM)
   - `JWT_PUBLIC_KEY` (SPKI PEM)
3. Install:
   - `pnpm install`
4. Start infra + server:
   - `docker compose up`

## Minimal local run

1. Install dependencies:
   - `pnpm install`
2. One-command start:
   - `pnpm dev:all`
3. Open app:
   - `http://localhost:5173`

`dev:setup` is safe to run multiple times: it keeps existing non-placeholder values and only generates missing placeholders (`JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `TURN_SECRET`).

Manual split mode (if needed):

- `pnpm dev:setup`
- `pnpm dev:infra`
- `pnpm dev:server`
- `pnpm dev:client`

## Validation matrix

Use this quick guide to pick the right validation scope:

| Goal                                                 | Fastest command                | Notes                                                                |
| ---------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| Quick API + signaling sanity check                   | `pnpm smoke:minimal`           | Runs HTTP + WS happy-path only.                                      |
| Quick API + signaling sanity with startup resilience | `pnpm smoke:minimal:retry`     | Retries on transient startup/network hiccups.                        |
| HTTP security headers only                           | `pnpm smoke:http:security`     | Verifies security headers on auth/turn HTTP endpoints.               |
| Full signaling smoke coverage                        | `pnpm smoke:all`               | Includes HTTP auth-cookie checks + WS negative-path checks.          |
| Strict WS-only validation                            | `pnpm smoke:ws:strict`         | Runs WS schema limits + WS negative checks (without HTTP smoke).     |
| Quick browser E2E sanity                             | `pnpm e2e:minimal`             | Minimal Playwright flow: `join -> text -> read receipt`.             |
| Quick browser E2E with resilience                    | `pnpm e2e:minimal:retry`       | Retries minimal Playwright flow.                                     |
| Reconnect-focused browser E2E                        | `pnpm e2e:reconnect`           | Runs only reconnect/resume Playwright scenarios (`@reconnect`).      |
| Full browser E2E                                     | `pnpm e2e`                     | Runs all Playwright scenarios.                                       |
| Full browser E2E with resilience                     | `pnpm e2e:retry`               | Retries full Playwright suite.                                       |
| One-command fast validation                          | `pnpm validate:fast`           | Runs `smoke:minimal:retry` then `e2e:minimal:retry`.                 |
| One-command security validation                      | `pnpm validate:security:retry` | Runs security pipeline with retry wrapper for cold-start resilience. |
| One-command full validation                          | `pnpm validate:full`           | Runs `smoke:all`, `e2e:retry`, `lint`, `typecheck`.                  |

## Recommended sequences

Use these presets depending on delivery stage:

1. Before commit (quick feedback loop):
   - `pnpm lint`
   - `pnpm validate:fast`

2. Before push to shared branch:
   - `pnpm validate:fast`
   - `pnpm test`

3. Before release / production deploy:
   - `pnpm release:readiness`
   - optional live readiness check: `pnpm release:readiness:live`
   - `pnpm validate:full`
   - one-command alternatives:
     - `pnpm pre-release:full`
     - `pnpm pre-release:live`
   - optional load check: `pnpm load:k6:signaling:quick:summary`

For a formal go/no-go flow, use [RELEASE_CHECKLIST.md](/Users/dmitrijsuvalov/Documents/P2P_Messenger/RELEASE_CHECKLIST.md).

## Smoke check (local)

1. Start app locally:
   - `pnpm dev:all`
2. In a new terminal, run all automated smoke checks:
   - `pnpm smoke:all`
   - quick baseline only (HTTP + WS happy-path): `pnpm smoke:minimal`
   - quick baseline with auto-retry (useful on cold start): `pnpm smoke:minimal:retry`
3. Open two browser tabs:
   - `http://localhost:5173`
   - `http://localhost:5173`
4. In both tabs:
   - Allow camera/mic permissions
   - Set the same `Room ID` (example: `room-local`)
   - Click `Connect`
5. Validate minimal P2P behavior:
   - `Signaling status` becomes `connected`
   - `Remote peers` becomes `1` in both tabs
   - Send text from tab A and verify it appears in tab B
   - Send reaction (👍/❤️/😂) and verify it appears on the message in the other tab
6. Optional quick media check:
   - Toggle mute/camera and verify status changes
   - Start/stop screen share and verify stream switches without reconnect

You can still run checks separately if needed:

- `pnpm smoke:http`
  - includes HTTP security-header assertions for auth/turn routes (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `CSP`)
- `pnpm smoke:http:security` (same HTTP security-header assertions, useful as an explicit CI/manual target)
- `pnpm smoke:http:security:retry` (retry wrapper for HTTP security smoke)
  - writes JSON summary to `artifacts/security/smoke-http-security-summary.json`
  - summary path can be overridden via `P2P_SMOKE_HTTP_SECURITY_SUMMARY_PATH`
- `pnpm smoke:auth` (aggregated auth smoke: `smoke:auth:lifecycle-only` + `smoke:auth:reuse-only`)
  - runner writes JSON summary to `artifacts/security/auth-smoke-summary.json`
  - summary path can be overridden via `P2P_AUTH_SMOKE_SUMMARY_PATH`
- `pnpm smoke:auth:retry` (retry wrapper for aggregated auth smoke)
- `pnpm smoke:auth:lifecycle-only` (auth cookie lifecycle: dev-login -> refresh(cookie) -> logout(cookie) -> refresh denied with `UNAUTHORIZED`)
- `pnpm smoke:auth:reuse-only` (focused refresh-token-family abuse check: old refresh reuse -> `TOKEN_REUSE_DETECTED`, then family blocked -> `UNAUTHORIZED`)
- `pnpm smoke:auth:reuse-only:retry` (retry wrapper for focused refresh-token-family abuse check)
- `pnpm smoke:auth:audit-only` (auth audit endpoint checks: `/auth/audit` requires bearer token, rejects invalid token, returns own login audit event on success)
- `pnpm smoke:auth:audit-only:retry` (retry wrapper for auth audit smoke)
  - writes JSON summary to `artifacts/security/auth-audit-smoke-summary.json`
  - summary path can be overridden via `P2P_AUTH_AUDIT_SMOKE_SUMMARY_PATH`
- `pnpm smoke:ws`
- `pnpm smoke:ws:limits` (fast schema-limit checks for oversized `join.peerPublicKey`, `offer.sdp`, `ice-candidate.candidate`)
- `pnpm smoke:ws:strict` (runs `smoke:ws:limits` + `smoke:ws:negative:retry`)
- `pnpm smoke:ws:negative` (checks invalid `Origin` rejection, `INVALID_JSON`, `SCHEMA_VALIDATION_FAILED`, `RATE_LIMITED`, `ROOM_IS_FULL` paths)
- `pnpm smoke:ws:negative:retry` (retry wrapper for WS negative checks)
  - writes JSON summary to `artifacts/security/smoke-ws-negative-summary.json`
  - summary path can be overridden via `P2P_SMOKE_WS_NEGATIVE_SUMMARY_PATH`
- also checks oversized signaling schema payloads (`join.peerPublicKey`, `offer.sdp`, `ice-candidate.candidate`) are rejected with `SCHEMA_VALIDATION_FAILED`
- also checks malformed `peerPublicKey` bundle marker does not crash signaling flow (backward/robustness scenario)

## Load baseline (k6)

Run baseline signaling load test:

- `pnpm load:k6:signaling`
- Quick local baseline:
  - `pnpm load:k6:signaling:quick`
- Quick baseline + JSON summary export:
  - `pnpm load:k6:signaling:quick:summary`
- Stress profile (higher concurrency, relaxed thresholds):
  - `pnpm load:k6:signaling:stress`
- Stress profile + JSON summary export:
  - `pnpm load:k6:signaling:stress:summary`
- Compare two summary files:
  - `pnpm load:k6:compare -- artifacts/k6/base.json artifacts/k6/candidate.json`
  - Compared metrics: `http_req_failed`, `ws_upgrade_success_rate`, `ws_connecting p95`, `signaling_session_ms p95`
  - Compare runs of the same profile (`quick` vs `quick`, `stress` vs `stress`) to avoid false regressions from different load levels.

What it does:

- HTTP: requests `/auth/dev-login` per VU iteration
- WebSocket: opens signaling socket, sends `join`, short hold, then `leave` and close
- Uses ramping VUs (default: `20 -> 40 -> 0`)

Useful env overrides:

- `K6_VUS_1`, `K6_VUS_2`, `K6_STAGE_1`, `K6_STAGE_2`, `K6_STAGE_3`
- `K6_ROOM_POOL_SIZE`, `K6_JOIN_HOLD_MS`, `K6_THINK_TIME_SECONDS`
- `K6_SIGNALING_CONNECT_P95_MS` (default threshold target: `50ms` for `ws_connecting`)
- `K6_SIGNALING_SESSION_P95_MS` (default threshold target: `400ms` for full join/hold/leave session)

If `k6` is missing:

- `brew install k6`

CI load workflow:

- `.github/workflows/k6-signaling.yml`
- Supports manual run (`quick`/`stress`) and nightly quick run.
- Uploads summary artifact `k6-signaling-<profile>-summary`.
- Attempts to fetch previous successful artifact of the same profile and run `load:k6:compare` automatically.
- Publishes a compact k6 metrics table into `GitHub Step Summary`.
- Publishes a baseline-vs-current trend table (`improved` / `regressed` / `stable`) in `GitHub Step Summary`.

Manual pre-release validation:

- `.github/workflows/ci.yml` also supports `workflow_dispatch` with:
  - `smoke-http-security`
  - `auth-smoke-only`
  - `auth-audit-only`
  - `smoke-only`
  - `ws-strict-only`
  - `smoke-minimal`
  - `e2e-minimal`
  - `e2e-reconnect-only`
  - `e2e-only`
  - `e2e-full-retry`
  - `validate-security`
  - `validate-fast`
  - `validate-full`
  - `release-readiness`
  - `release-readiness-live`
  - `pre-release-full`
  - `pre-release-live`
  - `smoke-and-e2e`
  - `smoke-e2e-k6`
- Starts local signaling + client runtime in CI, runs selected suites, and uploads logs/test artifacts.
- `smoke-http-security` runs only `smoke:http:security:retry` and writes `Smoke HTTP Security Summary` (`outcome`, `duration`, `pipeline`) to GitHub Step Summary.
  - also renders per-step details from `artifacts/security/smoke-http-security-summary.json` (via `scripts/render-smoke-http-summary.mjs`) and uploads it as CI artifact.
- `auth-smoke-only` runs `smoke:auth:retry` (`smoke:auth:lifecycle-only` + `smoke:auth:reuse-only` under retry wrapper) and writes `Auth Smoke Summary` (`outcome`, `duration`, `pipeline`) to GitHub Step Summary.
  - also renders per-step details from `artifacts/security/auth-smoke-summary.json` (via `scripts/render-auth-smoke-summary.mjs`) and uploads it as CI artifact.
- `auth-audit-only` runs `smoke:auth:audit-only:retry` (protected `/auth/audit` checks with retry wrapper) and writes `Auth Audit Summary` (`outcome`, `duration`, `pipeline`) to GitHub Step Summary.
  - also renders per-step details from `artifacts/security/auth-audit-smoke-summary.json` (via `scripts/render-auth-audit-summary.mjs`) and uploads it as CI artifact.
- `smoke-minimal` runs only `smoke:http` + `smoke:ws` (without negative-path suite).
- `ws-strict-only` runs strict WS checks only (`smoke:ws:strict` = `smoke:ws:limits` + `smoke:ws:negative:retry`), without HTTP smoke and without Playwright.
- `ws-strict-only` writes a compact `WS Strict Summary` table (`outcome`, `duration`, `pipeline`) to GitHub Step Summary.
  - also renders per-step details from `artifacts/security/smoke-ws-negative-summary.json` (via `scripts/render-smoke-ws-negative-summary.mjs`) and uploads it as CI artifact.
- `smoke-minimal` writes a compact `Smoke Minimal Summary` table (`outcome`, `duration`, `pipeline`) to GitHub Step Summary.
- `smoke-only` writes a compact `Smoke Full Summary` table (`outcome`, `duration`, `pipeline`) to GitHub Step Summary.
- `smoke-and-e2e` writes a compact `Smoke And E2E Summary` table (overall/smoke/e2e outcomes + durations + pipeline) to GitHub Step Summary.
- `e2e-minimal`, `e2e-only`, and `e2e-full-retry` write a compact `E2E Summary` table (`outcome`, `duration`, `pipeline`) to GitHub Step Summary.
- `validate-security` writes a compact `Validate Security Summary` table (`outcome`, `duration`, `pipeline`) to GitHub Step Summary.
  - also renders per-step details from `artifacts/security/validate-security-summary.json` (via `scripts/render-validate-security-summary.mjs`) and uploads it as CI artifact.
- `smoke-e2e-k6` writes a top-level `Smoke E2E K6 Summary` table (overall/smoke/e2e/k6 outcomes + durations + pipeline) to GitHub Step Summary.
- `release-readiness` and `release-readiness-live` write a compact `Release Readiness Summary` table (`outcome`, `duration`, `pipeline`) to GitHub Step Summary.
- `pre-release-full` runs `release:readiness -> validate:full` and writes a top-level `Pre Release Full Summary` table (overall/readiness/validate outcomes + durations + pipeline) to GitHub Step Summary.
- `pre-release-live` runs `release:readiness:live -> validate:full` and writes a top-level `Pre Release Live Summary` table (overall/readiness/validate outcomes + durations + pipeline) to GitHub Step Summary.
- `smoke-minimal` in CI uses `smoke:minimal:retry` (`3` attempts, `1500ms` delay by default).
- Retry knobs:
  - `P2P_SMOKE_RETRY_ATTEMPTS` (default `3`)
  - `P2P_SMOKE_RETRY_DELAY_MS` (default `1500`)
- `auth-smoke-only` in CI uses `smoke:auth:retry` (`2` attempts, `1500ms` delay by default).
- Auth smoke retry knobs:
  - `P2P_AUTH_SMOKE_RETRY_ATTEMPTS` (default `2`)
  - `P2P_AUTH_SMOKE_RETRY_DELAY_MS` (default `1500`)
- Auth audit smoke retry knobs:
  - `P2P_AUTH_AUDIT_SMOKE_RETRY_ATTEMPTS` (default `2`)
  - `P2P_AUTH_AUDIT_SMOKE_RETRY_DELAY_MS` (default `1500`)
- Auth reuse-only smoke retry knobs:
  - `P2P_SMOKE_AUTH_REUSE_RETRY_ATTEMPTS` (default `2`)
  - `P2P_SMOKE_AUTH_REUSE_RETRY_DELAY_MS` (default `1500`)
- WS negative retry knobs:
  - `P2P_SMOKE_WS_NEGATIVE_RETRY_ATTEMPTS` (default `2`)
  - `P2P_SMOKE_WS_NEGATIVE_RETRY_DELAY_MS` (default `1500`)
- HTTP security smoke retry knobs:
  - `P2P_SMOKE_HTTP_SECURITY_RETRY_ATTEMPTS` (default `2`)
  - `P2P_SMOKE_HTTP_SECURITY_RETRY_DELAY_MS` (default `1500`)
- `e2e-minimal` runs only the fast Playwright `@minimal` flow (`join -> text -> read receipt`).
- `e2e-reconnect-only` runs only reconnect/resume Playwright flow (`@reconnect` via `pnpm e2e:reconnect`).
- `e2e-minimal` in CI uses `e2e:minimal:retry` (`2` attempts, `2000ms` delay by default).
- E2E retry knobs:
  - `P2P_E2E_RETRY_ATTEMPTS` (default `2`)
  - `P2P_E2E_RETRY_DELAY_MS` (default `2000`)
- `e2e-full-retry` runs full Playwright suite via `e2e:retry` (`2` attempts, `3000ms` delay by default).
- Full E2E retry knobs:
  - `P2P_E2E_FULL_RETRY_ATTEMPTS` (default `2`)
  - `P2P_E2E_FULL_RETRY_DELAY_MS` (default `3000`)
- `validate-fast` runs the aggregated pipeline `validate:fast` (`smoke:minimal:retry` -> `e2e:minimal:retry`).
- `validate-security` runs the aggregated pipeline `validate:security:retry` (`validate:security` with retries).
  - underlying `validate:security` runner executes retry-aware steps:
    - `smoke:http:security:retry -> smoke:auth:reuse-only:retry -> smoke:auth:audit-only:retry -> smoke:ws:negative:retry`
  - non-retry variants remain available for strict debugging.
  - local runner also prints a compact per-step summary with pass/fail status and durations.
  - local runner writes JSON summary to `artifacts/security/validate-security-summary.json` (override path via `P2P_VALIDATE_SECURITY_SUMMARY_PATH`).
- Security retry knobs:
  - `P2P_VALIDATE_SECURITY_RETRY_ATTEMPTS` (default `2`)
  - `P2P_VALIDATE_SECURITY_RETRY_DELAY_MS` (default `2000`)
- `validate-full` runs the aggregated pipeline `validate:full` (`smoke:all` -> `e2e:retry` -> `lint` -> `typecheck`).
- `smoke-e2e-k6` also runs `load:k6:signaling:quick:summary` and uploads `artifacts/k6/*.json`.
- `smoke-e2e-k6` writes key k6 metrics into `GitHub Step Summary`.
- `smoke-e2e-k6` also fetches the latest successful quick baseline artifact, runs compare, and renders trend table in `GitHub Step Summary`.

## E2E smoke (Playwright)

1. Install Playwright browser once:
   - `pnpm exec playwright install chromium`
2. Run e2e smoke test:
   - `pnpm e2e`
   - full suite with auto-retry: `pnpm e2e:retry`
   - quick minimal flow only: `pnpm e2e:minimal`
   - quick minimal flow with auto-retry: `pnpm e2e:minimal:retry`
   - reconnect/resume focused flow only: `pnpm e2e:reconnect`
3. If app/infra is already running and you want to skip Playwright managed webServer:
   - `pnpm e2e:local`
   - quick minimal flow with existing local runtime: `pnpm e2e:minimal:local`
   - (uses `PW_USE_MANAGED_WEBSERVER=0`)

Current e2e scenario:

- Minimal fast path (`@minimal`):
  - room id is persisted in UI across page reload (`sessionStorage`)
  - two tabs join one room
  - sender sends one text message
  - receiver gets the message
  - sender receives read receipt (`sent` -> `read`)
- Reconnect and resume path (`@reconnect`):
  - peer reconnect restores remote peer visibility after forced WS close
  - text chat delivery recovers after forced signaling reconnect
  - file transfer resumes/completes after forced reconnect (single and multi reconnects)
  - missing file chunks are requested and recovered after reconnect
- Opens two tabs
- Joins both tabs into one room
- Verifies both peers become visible (`Remote peers: 1`)
- Verifies signaling status is `connected` in both tabs
- Sends one text message from tab A and verifies delivery in tab B (DataChannel)
- Verifies chat receipt state updates from `sent` to `read` on sender side
- Verifies reaction sync by sending `👍` from receiver and asserting it appears on sender side
- Sends one small file from tab A and verifies receiver status `completed` plus `Download` link
- Forces signaling reconnect during active file transfer and verifies transfer resumes to `completed`
- Forces multiple signaling reconnects during active file transfer and verifies transfer still reaches `completed`
- Simulates dropped outgoing file chunks, forces reconnect, and verifies receiver requests only `missingChunks` before final `completed`
- Verifies sender-side DataChannel wire payloads use encrypted envelope (`payload.type = encrypted`) and do not leak plaintext `text` / `file-chunk` payload types
- Corrupts sender-side file checksum metadata and verifies receiver marks transfer as `failed` (`Checksum mismatch.`)
- Forces signaling socket close for one peer and verifies reconnect restores `Remote peers: 1`
- Verifies security fingerprint flow (`unverified` → `matched` → `unmatched` → `unverified`)

## Dev auth flow

- `GET /auth/dev-login?userId=demo-user` returns `{ accessToken, refreshToken }` (disabled in production mode).
- `GET /auth/refresh?token=<refreshToken>` rotates refresh token and returns a new pair.
- `GET /turn-credentials` requires `Authorization: Bearer <accessToken>`.

## Implemented now

- DataChannel chat/file messages are signed with an ECDSA P-256 identity key.
- Peer key exchange now uses a backward-compatible signaling key bundle (`signing + ECDH` public keys in `peerPublicKey`), while legacy signing-only peers still work.
- DataChannel payloads now support an encrypted envelope (`payload.type = encrypted`) with per-peer AES-256-GCM keys derived via ECDH.
- File transfer chunks (`file-chunk`) are now also encrypted by the same envelope when peer ECDH keys are available.
- Outgoing delivery logic is now split by intent: chat/reactions may use deferred queue retry, while `file-meta`/`file-chunk` use strict non-queued delivery to keep transfer progress/resume accounting correct.
- Chat/file payload crypto logic is extracted into a dedicated client module with unit tests (bundle encode/decode, encrypted chunk path, plaintext fallback).
- Crypto payload unit tests also cover malformed bundle handling, missing shared-key decrypt errors, and invalid decrypted schema rejection.
- Client decrypt-path tests also cover corrupted ciphertext errors and non-string plaintext safety checks.
- Incoming DataChannel messages are verified by signature and strict `senderId === peerId` binding.
- Client persists signing keys in IndexedDB (`secure-kv`) and migrates legacy key material from `sessionStorage` on first load.
- `peerPublicKey` used in signaling join now contains the exported SPKI public key.
- Client UI shows local and remote SHA-256 key fingerprints for manual peer verification.
- Security UI supports fingerprint copy and manual `matched / not matched` marking per peer.
- Security UI also supports `unverified` status via per-peer `Clear` and global `Reset all verifications`.
- Security UI shows a short status notice for copy/verify/reset actions.
- Client UI sections are split into dedicated components (`ConnectionPanel`, `SecurityPanel`, `MediaPanel`, `ChatPanel`, `FilesPanel`, `VideoView`).
- Mobile call controls are extracted into `MobileCallControls` component with dedicated unit tests.
- Mobile chat sheet is extracted into `MobileChatSheet` component with dedicated gesture/toggle tests.
- Mobile viewport detection is centralized in `useIsMobileViewport` hook with unit tests.
- Mobile layout constants are centralized in `layout.ts` to avoid duplicated magic numbers.
- Mobile inline style objects are extracted into reusable helpers in `mobile-styles.ts`.
- `MobileChatSheet` now supports closing via `Escape` key in addition to swipe/toggle.
- `MobileChatSheet` now manages focus: chat input on open, handle button on close.
- `MobileChatSheet` handle is now linked to panel via `aria-controls` for clearer a11y semantics.
- `ConnectionPanel` now exposes a polite live region for signaling/quality updates.
- Mobile call toggle buttons now expose `aria-pressed` state for better accessibility.
- Chat reaction buttons now expose descriptive `aria-label` values per message sender.
- Security actions now expose peer-scoped `aria-label` values (`copy`, `matched`, `unmatched`, `clear`).
- Media quality legend and per-peer quality badges now expose descriptive `aria-label` values.
- Shared `StatusNotice` component now standardizes polite live-region announcements across panels.
- Shared `AlertNotice` component now standardizes assertive alert announcements (used in `DeviceSelector`).
- `App` now renders top-level signaling/runtime errors via shared `AlertNotice`.
- Notice visuals are standardized via shared `notice-styles.ts` used by both `StatusNotice` and `AlertNotice`.
- `FilesPanel` now exposes accessible transfer progress via labeled `progressbar` regions (overall + per-peer).
- `FilesPanel` includes local transfer filtering (`all`, `active`, `completed`, `failed`) for easier triage.
- `FilesPanel` includes local sorting (`recent first`, `largest first`) to prioritize heavier transfers.
- `FilesPanel` filter options now include live counters (`All/Active/Completed/Failed`).
- `FilesPanel` adds quick filter actions (`Active only`, `Failed only`, `Show all`) with pressed-state semantics.
- `FilesPanel` persists selected filter/sort preferences in `localStorage`.
- File chunk/assembly happy-path logic is extracted to `file-transfer-utils` and covered by dedicated unit tests (chunk count, missing chunks, assemble, missing-chunk failure).
- If receiver detects file integrity failure (for example checksum mismatch), it now sends `file-ack: rejected`, so sender also finalizes transfer as failed instead of hanging in `sending/accepted`.
- Outgoing file transfers are now kept across temporary peer disconnects (state is not dropped immediately), so reconnect/reannounce can continue transfer negotiation instead of failing instantly.
- Fingerprint verification state/side-effects are encapsulated in `useFingerprintVerification`.
- Client entrypoint is split into `app.tsx` (UI composition) and `main.tsx` (React bootstrap).
- Client has Vitest + jsdom tests for `useFingerprintVerification`, `SecurityPanel`, and `ChatPanel` (`pnpm test` / `pnpm --filter @p2p/client test`).
- `@p2p/server` has unit tests for `RoomManager` and `ConnectionRateLimiter`.
- `RoomManager.joinRoom` now uses an atomic Redis Lua script to enforce room capacity under concurrent joins and still allow same-peer rejoin/update.
- Signaling rate limiting now uses a Redis-backed token bucket (leaky-bucket behavior) instead of a fixed per-second counter.
- Signaling join flow now safely handles same-socket rejoin with a different `peerId` (old peer session is left first), preventing stale peer-id mappings.
- Client now keeps `roomId` in `sessionStorage` in sync with UI state, so page refresh restores the room field and reconnect flow consistently.
- Room `sessionStorage` handling is extracted into a dedicated client utility with unit tests (`read/write/trim/clear + storage-failure safety`).
- `@p2p/server` also has `AuthService` tests for refresh rotation, token reuse detection, and family revoke behavior.
- `AuthService` now also supports explicit refresh-family revocation (`revoke`) used by logout flow.
- Server now exposes `GET /auth/logout?token=<refreshToken>` to revoke refresh token family.
- Server auth endpoints (`/auth/dev-login`, `/auth/refresh`, `/auth/logout`) now also support `HttpOnly` refresh cookie (`refreshToken`) and keep query-token fallback for backward compatibility.
- Server now emits structured auth audit events (`auth_audit`) for `login`, `token_refresh`, `logout` including result, IP and user-agent.
- Auth audit events are persisted in Redis (`auth:audit:events`) with retention controls via `AUTH_AUDIT_LOG_MAX_ENTRIES` and `AUTH_AUDIT_LOG_TTL_SECONDS`.
- Server exposes `GET /auth/audit?limit=50` (requires `Authorization: Bearer <accessToken>`) to fetch latest persisted auth audit events for diagnostics.
- Server now applies baseline security headers on HTTP routes (CSP, frame-ancestors deny, no-sniff, referrer policy, permissions policy, HSTS in production).
- Client auth bootstrap now requests auth endpoints with `credentials: include` to support cookie-based refresh/logout flow in cross-origin local dev.
- Client refresh path now attempts cookie-based `/auth/refresh` even when session refresh token is absent/expired in `sessionStorage`.
- Client disconnect now calls `/auth/logout` (cookie/token aware), then clears local auth tokens.
- `@p2p/shared` has schema contract tests for signaling/chat Zod parsers.
- `@p2p/shared` schema tests include encrypted payload boundary checks (`ivBase64`/`ciphertextBase64` limits and invalid field types).
- Signaling contract tests explicitly cover `join.peerPublicKey` in both legacy string form and `p2p-key-bundle-v1:<base64-json>` form.
- `peerPublicKey` signaling payload is bounded (`1..4096` chars) and oversized join/broadcast payloads are rejected by schema validation.
- Signaling schema now also bounds SDP/ICE fields (`sdp <= 7500`, `candidate <= 4096`, `usernameFragment <= 256`) for both inbound and relayed messages, with contract tests for oversized payload rejection.
- `@p2p/webrtc` has tested utilities for adaptive bitrate (`setVideoBitrate`) and connection-quality assessment (`assessConnectionQuality` for packet loss/RTT/jitter).
- `SignalingTransport` reconnect logic is hardened and covered by unit tests:
  - exponential backoff exhaustion path
  - reconnect counter reset on manual reconnect
  - stale WebSocket close/error/message events are ignored after socket replacement
  - reconnect-from-session no-op when stored room id is absent
  - explicit disconnect cancels pending reconnect timer
  - leave sends signaling leave message and clears stored room id
- `PeerManager` now has unit tests for initiator offer flow, queued ICE candidate flush after remote description, and relay-mode ICE restart behavior.
- `PeerManager` backpressure path is covered by tests: message send waits for `bufferedamountlow` when DataChannel buffer is saturated, and emits timeout error when drain signal never arrives.
- `PeerManager` now also enforces outbound DataChannel message size cap (`256KB`) before send and reports explicit errors for oversized serialized payloads.
- Client now consumes WebRTC stats every 2s, surfaces `quality / packet loss / RTT / jitter` in `ConnectionPanel`, and auto-adjusts outgoing video bitrate per peer.
- Client automatically toggles peer relay mode (`iceTransportPolicy: relay`) via ICE restart when degraded conditions persist, and shows network notices for bitrate/relay transitions.
- Relay switching on the client uses hysteresis + cooldown to avoid flapping and excessive renegotiation on unstable links.
- Network quality/relay notices are now displayed via Sonner toasts instead of inline panel text.
- `MediaPanel` now uses an adaptive video grid and highlights the dominant remote speaker via lightweight Web Audio level detection.
- Voice activity detection is extracted into `useVoiceActivity` hook with dedicated unit tests.
- Remote video tiles now display per-peer connection quality badges (`good` / `fair` / `poor`) derived from periodic WebRTC stats.
- Per-peer badges are color-coded and expose precise metrics (`loss / RTT / jitter`) via tooltip.
- `MediaPanel` includes quality legend, remote sorting (`join order` / `quality`) and an `issues only` filter for faster triage in larger rooms.
- Pre-join `DeviceSelector` is implemented with camera/mic/speaker selection, live media preview, refresh action, and persisted preferences via localStorage.
- Selected speaker output is applied to remote video elements via `setSinkId` where supported.
- `DeviceSelector` includes a pre-join microphone level meter powered by Web Audio `AnalyserNode`.
- Pre-join mic calibration hints are shown (`input too low` / `good level` / `too hot`) based on live level thresholds.
- `DeviceSelector` now provides a short test tone to validate output routing before joining a call.
- Pre-join permission status for camera/microphone is surfaced, including an explicit blocked-access hint.
- On mobile viewports, chat is available as a bottom sheet with swipe-up/swipe-down gesture and quick toggle.
- Mobile viewports now include a fixed bottom call-control bar (`mute`, `camera`, `share`, `chat`) wired to signaling actions.
- `App` now has component tests for desktop/mobile chat layout, mobile toggle, and swipe gestures.
- `@p2p/crypto` includes reusable primitives for:
  - ECDSA sign/verify key lifecycle (generate/import/export/serialize)
  - ECDH key exchange + derived AES-256-GCM key
  - AES-GCM encrypt/decrypt helpers
  - SHA-256 and public key fingerprint helpers
- `@p2p/crypto` now has unit tests for sign/verify, signing key serialization roundtrip, ECDH shared-key derivation, and ECDH key export/import roundtrip.

## Workspace layout

- `apps/client` - React client
- `apps/server` - signaling/auth service
- `apps/turn` - coturn configuration
- `packages/shared` - shared types/schemas
- `packages/crypto` - crypto primitives
- `packages/webrtc` - WebRTC core logic
- `packages/ui` - reusable UI components

# P2P_Messenger
