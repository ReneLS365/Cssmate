# BASELINE GAPS (Task 2 update)

This file tracks remaining verification blockers after baseline hardening.

## Closed gaps

1. `test:integration` broken path mismatch: **closed**.
   - Previous broken glob `tests/integration/*.test.js` is replaced by deterministic discovery runner (`scripts/run-integration-tests.mjs`).
   - Command now reports discovered files or explicit empty-suite state.

2. `ci:all` ambiguous ordering and silent behavior: **closed**.
   - `scripts/ci-all.mjs` now logs and executes deterministic ordered steps:
     - guard/lint
     - conditional drift/db checks
     - test
     - integration
     - build
     - smoke build
     - export test
     - E2E
     - optional bundle perf

3. Playwright missing-lib ambiguity: **closed**.
   - `scripts/playwright-preflight.mjs` now fails fast with explicit guidance and supports `PLAYWRIGHT_INSTALL_WITH_DEPS=1`.

## Remaining blocker

1. E2E server bootstrap (`e2e:serve`) can fail in this container.
   - Observed: `netlify dev` terminates with `fetch failed` while setting up Edge Functions/plugins, so readiness wait fails.
   - Impact: `npm run test:e2e` and `npm run ci:all` fail honestly in this environment.
   - Current safety posture: no skip/bypass added; failures remain explicit.

## Guardrail statement

No business logic/runtime output paths were changed. Task 2 only hardens verification scripts, CI orchestration, test gating for deterministic baseline behavior, and documentation.
