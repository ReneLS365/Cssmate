# Verification baseline (Task 2)

This document defines the canonical baseline verification commands for Cssmate before UI-port work.

## Canonical commands

1. `npm run test`
2. `npm run test:integration`
3. `npm run build`
4. `npm run smoke:build`
5. `npm run test:export`
6. `npm run test:e2e`
7. `npm run ci:all`

`npm run ci:all` is the aggregate baseline command and now runs these core checks in deterministic order with step-by-step logging.

## Integration test contract

`npm run test:integration` now uses `scripts/run-integration-tests.mjs`.

- If dedicated integration files exist under `tests/integration/**` (`*.test.js` / `*.spec.js`), they are listed and executed.
- If the folder does not exist (or has no dedicated integration files), the command exits `0` with an explicit empty-suite message.
- The command never reports that integration tests ran when no files were found.

## Deterministic E2E contract

`npm run test:e2e` now uses `scripts/run-e2e-ci.mjs` and executes:

1. Playwright preflight (`scripts/playwright-preflight.mjs`):
   - installs browser binary
   - optionally installs Linux deps with `PLAYWRIGHT_INSTALL_WITH_DEPS=1`
   - launch-probes Chromium and fails fast with actionable guidance on missing libs
2. Starts `npm run e2e:serve`
3. Waits for readiness with `node tools/wait-for-url.mjs`
4. Runs Playwright with `PLAYWRIGHT_SKIP_WEBSERVER=1`
5. Cleans up the server process on success/failure

## Environment requirements for full green baseline

- Node version from `.nvmrc` (repo currently warns on Node 20 due engine requirement)
- Linux env that can run `netlify dev` for `e2e:serve`
- Playwright browser dependencies present (`npx playwright install --with-deps chromium` when supported)

If runtime prerequisites are missing, `test:e2e` and therefore `ci:all` fail explicitly rather than silently skipping.
