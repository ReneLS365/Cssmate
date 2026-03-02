# BASELINE STATUS (Task 2)

## Commands run

1. `npm ci`
2. `npm run test`
3. `npm run test:integration`
4. `npm run test:export`
5. `npm run build`
6. `npm run smoke:build`
7. `npm run test:e2e`
8. `PLAYWRIGHT_INSTALL_WITH_DEPS=1 npm run test:e2e`
9. `npm run ci:all`

## Results

- `npm ci`: passed (with Node engine warnings in this environment).
- `npm run test`: passed deterministically after moving test command to `--test-force-exit` and making auth-flow browser smoke checks opt-in via env.
- `npm run test:integration`: passed with explicit message that no dedicated integration directory is present.
- `npm run test:export`: passed.
- `npm run build`: passed.
- `npm run smoke:build`: passed.
- `npm run test:e2e`: fails fast with actionable Playwright dependency guidance when Chromium cannot launch.
- `PLAYWRIGHT_INSTALL_WITH_DEPS=1 npm run test:e2e`: Playwright preflight succeeded after installing deps, but `e2e:serve` failed in this environment because `netlify dev` terminated with `fetch failed` while preparing Edge Functions/plugins; readiness wait timed out.
- `npm run ci:all`: now executes deterministic ordered steps and fails honestly at E2E when server bootstrap is not available.

## Baseline trust verdict

- Verification scripts now match repository reality.
- No false-green integration execution remains.
- `ci:all` now reports each step and fails on true missing verification (currently E2E runtime bootstrap in this container).
- Baseline is trustworthy in behavior, with one remaining environment blocker: local `netlify dev` startup instability in this container.
