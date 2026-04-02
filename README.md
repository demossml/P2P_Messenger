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

## Smoke check (local)
1. Start app locally:
   - `pnpm dev:all`
2. In a new terminal, run all automated smoke checks:
   - `pnpm smoke:all`
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
- `pnpm smoke:ws`
- `pnpm smoke:ws:negative` (checks invalid `Origin` rejection, `INVALID_JSON`, `SCHEMA_VALIDATION_FAILED`, `RATE_LIMITED`, `ROOM_IS_FULL` paths)

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
  - `smoke-only`
  - `e2e-only`
  - `smoke-and-e2e`
  - `smoke-e2e-k6`
- Starts local signaling + client runtime in CI, runs selected suites, and uploads logs/test artifacts.
- `smoke-e2e-k6` also runs `load:k6:signaling:quick:summary` and uploads `artifacts/k6/*.json`.
- `smoke-e2e-k6` writes key k6 metrics into `GitHub Step Summary`.
- `smoke-e2e-k6` also fetches the latest successful quick baseline artifact, runs compare, and renders trend table in `GitHub Step Summary`.

## E2E smoke (Playwright)
1. Install Playwright browser once:
   - `pnpm exec playwright install chromium`
2. Run e2e smoke test:
   - `pnpm e2e`
3. If app/infra is already running and you want to skip Playwright managed webServer:
   - `pnpm e2e:local`
   - (uses `PW_USE_MANAGED_WEBSERVER=0`)

Current e2e scenario:
- Opens two tabs
- Joins both tabs into one room
- Verifies both peers become visible (`Remote peers: 1`)
- Verifies signaling status is `connected` in both tabs
- Sends one text message from tab A and verifies delivery in tab B (DataChannel)
- Verifies chat receipt state updates from `sent` to `read` on sender side
- Verifies reaction sync by sending `👍` from receiver and asserting it appears on sender side
- Sends one small file from tab A and verifies receiver status `completed` plus `Download` link
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
- `@p2p/server` also has `AuthService` tests for refresh rotation, token reuse detection, and family revoke behavior.
- `@p2p/shared` has schema contract tests for signaling/chat Zod parsers.
- `@p2p/shared` schema tests include encrypted payload boundary checks (`ivBase64`/`ciphertextBase64` limits and invalid field types).
- Signaling contract tests explicitly cover `join.peerPublicKey` in both legacy string form and `p2p-key-bundle-v1:<base64-json>` form.
- `@p2p/webrtc` has tested utilities for adaptive bitrate (`setVideoBitrate`) and connection-quality assessment (`assessConnectionQuality` for packet loss/RTT/jitter).
- `SignalingTransport` reconnect logic is hardened and covered by unit tests:
  - exponential backoff exhaustion path
  - reconnect counter reset on manual reconnect
  - stale WebSocket close/error/message events are ignored after socket replacement
- `PeerManager` now has unit tests for initiator offer flow, queued ICE candidate flush after remote description, and relay-mode ICE restart behavior.
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
