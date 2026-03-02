# BASELINE GAPS

This file tracks baseline-protection gaps found during Task 1 that were not safely fixable without changing runtime/business logic.

## Gaps observed

1. `npm run test:integration` currently fails because `tests/integration/*.test.js` does not exist.
   - Impact: no dedicated integration suite currently runs from that script.
   - Safe follow-up: either add real integration tests in that folder or update the script contract in a separate maintenance task.

2. `npm run test:e2e` cannot run in this container due missing Chromium system dependency (`libatk-1.0.so.0`).
   - Impact: end-to-end baseline cannot be fully validated in this environment.
   - Safe follow-up: use CI/container image with Playwright Linux dependencies preinstalled.

3. `npm run ci:all` does not complete in this environment because it stalls after `npm run test` phase (process does not naturally return in this shell session).
   - Impact: full aggregate pipeline status is not available from this run.
   - Safe follow-up: investigate hanging node-test handle lifecycle in CI script orchestration.

## Guardrail decision

No runtime/business logic was changed to workaround these gaps. Gaps are documented instead, per baseline safety policy.
