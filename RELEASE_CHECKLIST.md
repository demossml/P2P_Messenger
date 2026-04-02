# Release Checklist

Use this checklist before merging a release candidate to `main` or deploying to production.

## 1. Environment readiness

- [ ] Local/CI env variables are present and non-placeholder (`JWT_*`, `TURN_*`, `REDIS_URL`).
- [ ] Infrastructure dependencies are healthy (`redis`, signaling server, client runtime).
- [ ] Branch is up to date with latest `main`.

## 2. Quality gates

- [ ] Run release readiness audit:
  - `pnpm release:readiness`
  - Optional live health check: `pnpm release:readiness:live`
- [ ] Run fast validation:
  - `pnpm validate:fast`
- [ ] Run full validation:
  - `pnpm validate:full`
- [ ] Optional quick load baseline (recommended for release):
  - `pnpm load:k6:signaling:quick:summary`

## 3. Security and protocol sanity

- [ ] Signaling negative-path smoke is green (`INVALID_JSON`, schema errors, rate-limit, room-full).
- [ ] DataChannel encrypted envelope checks are green in E2E.
- [ ] Fingerprint verification flow is green in E2E.

## 4. CI confirmation

- [ ] `CI / checks` job is green (`lint`, `typecheck`, `build`).
- [ ] `manual-validation` run is green in one of:
  - `validate-fast`
  - `validate-full`
  - `smoke-e2e-k6` (for pre-release confidence)
- [ ] Artifacts are uploaded and reviewed when needed (`playwright-report`, runtime logs, k6 summary).

## 5. Release decision

- [ ] No open P0/P1 defects.
- [ ] Rollback plan is known (previous stable commit/tag).
- [ ] Team sign-off recorded.

## 6. Post-release quick verification

- [ ] Run `pnpm smoke:minimal` against deployed environment.
- [ ] Confirm basic room join + text delivery manually in two tabs.
- [ ] Monitor errors/logs for at least 10-15 minutes after release.
