# BASELINE STATUS (Task 1)

## Commands run

1. `npm ci`
2. `npm run ci:all`
3. `npm run test`
4. `npm run test:integration`
5. `npm run test:export`
6. `npm run test:e2e`

## Results

- `npm ci`: passed (with Node engine warning in this environment).
- `npm run test`: unit test files shown as passing in output, but command hangs in this shell session after test execution output.
- `npm run test:integration`: failed (`tests/integration/*.test.js` not found).
- `npm run test:export`: passed.
- `npm run test:e2e`: failed in environment (Chromium missing `libatk-1.0.so.0`).
- `npm run ci:all`: started and passed early checks (`guard:deps`, `test:html`), but did not complete due same hang behavior after test phase.

## Known weak areas

- Dedicated integration-script target is currently empty/misaligned.
- E2E depends on OS-level Playwright dependencies not present in this container.
- Aggregate `ci:all` completion needs follow-up for hang behavior.

## Protected before UI port

- Freeze boundaries are documented in `docs/SAFE_KEEP_MANIFEST.md`.
- Lovable visual-port scope and risk boundaries are documented in `docs/LOVABLE_PORT_SCOPE.md`.
- Added an explicit core navigation smoke E2E spec (`tests/e2e/core-navigation-smoke.spec.ts`) to lock basic app-load/tab reachability behavior when E2E environment is healthy.

## Recommendation for Task 2

Run Task 2 as visual-only pilot changes in explicitly allowed UI zones, while keeping all frozen business/auth/export/import/shared areas untouched and running baseline checks in a CI environment with full Playwright Linux dependencies.
