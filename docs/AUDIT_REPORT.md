# Pre-release audit report

## Scope
- Repo: ReneLS365/Cssmate
- Focus: auth/functions, Team/Delt sager UI polish, safe cleanup, docs.

## Baseline status (phase 0)
- `npm ci`
  - Result: ✅ Completed with engine warnings (Node 20 vs required Node 22).
- `npm run build`
  - Result: ✅ Completed.
- `npm run lint`
  - Result: ✅ Completed.
- `npm run test`
  - Result: ❌ Failing test (see details below).
- `npm run typecheck`
  - Result: ⚠️ Script not present.

### Baseline failures
- `tests/akkord-export-ui.test.js` expects success message `Sag publiceret til fælles sager.` but actual message is `Eksporteret (Historik + Delt sager).`
- Test output also reports `MutationObserver is not defined` while booting in Node test environment.

## Fixes applied
### 1) Auth0 config normalization + consistent function errors
- **Problem:** Functions mixed AUTH0/VITE env resolution and returned vague auth errors.
- **Fix:** Introduced `getAuth0Config()` helper for functions, normalized issuer/audience/domain, added error codes, and guarded management token JSON parsing.
- **Evidence:** clearer `code` values on 401/403 and explicit Auth0 config handling.
- **Files:**
  - `netlify/functions/_auth.mjs`
  - `netlify/functions/api.mjs`
  - `netlify/functions/org-members.mjs`

### 2) Delt sager error copy no longer blames Team ID
- **Problem:** Error fallback suggested “ret Team ID” even when auth/config issues were the cause.
- **Fix:** Added auth-aware error mapping and replaced Team ID suggestion with login/network guidance.
- **Evidence:** UI now prioritizes Auth0 config/login errors and uses safer fallback copy.
- **Files:**
  - `js/shared-cases-panel.js`

### 3) Team tab text wrapping on mobile
- **Problem:** Long names/emails could overlap in the Team list.
- **Fix:** Added wrap/spacing styles for Team list rows.
- **Evidence:** `team-admin__list-row` and `team-admin__list-main` now wrap safely.
- **Files:**
  - `style.css`

## Final verification (phase 7)
- `npm run build` ✅
- `npm run lint` ✅
- `npm run test` ❌
  - Still failing due to export UI copy mismatch and missing `MutationObserver` in Node tests.

## Remaining risks / verification
- Manual smoke needed: login, Team tab mobile wrap, Delt sager empty/error state, export buttons.
- Known failing tests (copy alignment + DOM stubs) still need a product decision.

## Evidence log
- Auth0 config helper + error codes: `netlify/functions/_auth.mjs`, `netlify/functions/api.mjs`, `netlify/functions/org-members.mjs`.
- Delt sager error mapping: `js/shared-cases-panel.js`.
- Team mobile wrap: `style.css`.
