# Deep audit report (Auth0-only team access)

## Project inventory
- **Entrypoints:** `index.html`, `main.js`, `app-main.js`, `service-worker.js`.
- **Auth flow files:**
  - Auth0 client config and callbacks: `src/auth/auth0-client.js`, `src/auth/auth-callback.js`, `src/auth/resolve-base-url.js`.
  - Auth gating and UI: `src/auth/auth-gate.js`, `src/auth/auth0-ui.js`, `src/auth/force-login.js`, `src/ui/login-overlay.js`.
  - Session state and access checks: `src/auth/session.js`, `src/services/team-access.js`.
- **Export/import files:** `js/akkord-export.js`, `js/akkord-export-ui.js`, `js/akkord-converter.js`, `js/export-meta.js`, `js/export-model.js`, `js/akkord-data.js`, `js/shared-ledger.js`.
- **PWA / service worker files:** `service-worker.js`, `manifest.webmanifest`, `src/utils/reset-app.js`.
- **Build/deploy config files:** `netlify.toml`, `package.json`, `scripts/*`, `tools/*`, `netlify/functions/*`.

## Auth0 login correctness checklist
- **Login CTA or auto-login:**
  - Auto-login with guard is handled in `src/auth/force-login.js` and `src/auth/auth0-ui.js` (same sessionStorage guard key).
- **Loop prevention:**
  - `cssmate_autologin_attempted` sessionStorage guard in both auto-login paths.
  - Callback route detection via `src/auth/auth-callback.js` prevents repeated redirects.
- **Callback handling:**
  - `src/auth/auth0-client.js` handles `handleRedirectCallback()` and returns to `appState.returnTo` or current path.
- **Redirect URI correctness:**
  - `src/auth/resolve-base-url.js` derives redirect URI from runtime origin or env overrides.
- **Organization param validation:**
  - `src/auth/auth0-client.js` validates org ID/slug before sending.
- **User-visible error surfaces:**
  - Auth errors surface in `src/auth/auth0-ui.js` and `src/auth/force-login.js` via overlays.

## Commands run
Results recorded in `reports/audit/summary.md`.

## Must-fix items addressed
- Removed a committed `.env` file and added ignore rules for `.env`/`.env.*` to avoid secrets in git.
- Hardened `js/akkord-export-ui.js` against missing DOM APIs in non-browser test contexts (no behavior change in-browser).

## Remaining risks
- Playwright e2e suite could not launch Chromium in this environment (`libatk-1.0.so.0` missing), so e2e coverage remains unverified here.
- Node engine mismatch warnings (repo expects Node >=22) should be resolved in CI or the local environment before relying on Lighthouse/perf scripts.
