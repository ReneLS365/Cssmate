# Ranked optimization backlog

> Sorted by highest value (impact + low risk + low effort) first.

## 1) Stabilize Node test environment for DOM APIs
- **Impact:** High
- **Effort:** Small
- **Risk:** Low
- **Why:** Current tests report `MutationObserver is not defined`, indicating DOM API gaps in Node test runs.
- **Approach:** Provide a lightweight MutationObserver stub in test harness or guard initialization to avoid hard failures.
- **Where:** `tests/` harness setup, `boot-inline.js` initialization.

## 2) Align export success messaging with tested expectations
- **Impact:** Medium
- **Effort:** Small
- **Risk:** Low
- **Why:** Test expects `Sag publiceret til fælles sager.` while UI message differs.
- **Approach:** Decide on final copy, update UI copy + tests consistently.
- **Where:** `js/akkord-export-ui.js`, `tests/akkord-export-ui.test.js`.

## 3) Add dedicated env usage audit script
- **Impact:** Medium
- **Effort:** Small
- **Risk:** Low
- **Why:** Keep env usage list fresh and avoid config drift.
- **Approach:** Create `scripts/audit-env-usage.mjs` to parse `process.env.*` usage and emit a summary.
- **Where:** `scripts/`.

## 4) Add smoke script for build + function import checks
- **Impact:** Medium
- **Effort:** Small
- **Risk:** Low
- **Why:** Quick local verification step for function readiness.
- **Approach:** Script that runs `npm run build` and attempts to import Netlify functions with helpful errors.
- **Where:** `scripts/`.

## 5) Improve export/diagnostics tests for Auth0 config mismatch
- **Impact:** Medium
- **Effort:** Medium
- **Risk:** Low
- **Why:** Auth0 error handling is clearer in functions, but tests do not yet cover the new error codes.
- **Approach:** Add unit tests for `auth_*` codes in client error mapping.
- **Where:** `tests/`, `js/shared-cases-panel.js`.

## 6) Non-critical cleanup sweep
- **Impact:** Low
- **Effort:** Medium
- **Risk:** Low
- **Why:** Remove unused files/imports after confirming no references.
- **Approach:** Use `rg` to confirm zero references before deletion.
- **Where:** repo-wide.
