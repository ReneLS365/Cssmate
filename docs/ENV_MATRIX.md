# Environment variable matrix

This matrix documents env vars referenced in the repo, grouped by runtime target.

## Frontend (window.__ENV__ via auth0-config.js)
| Variable | Required | Example | Where used | Notes |
| --- | --- | --- | --- | --- |
| `VITE_AUTH0_DOMAIN` | Yes | `example.eu.auth0.com` | `scripts/generate-auth0-config.mjs`, `auth0-config.js` | Auth0 tenant domain for SPA login. |
| `VITE_AUTH0_CLIENT_ID` | Yes | `abc123` | `scripts/generate-auth0-config.mjs` | Auth0 SPA client id. |
| `VITE_AUTH0_AUDIENCE` | Yes | `https://api.sscaff.app` | `scripts/generate-auth0-config.mjs` | API audience used by SPA. |
| `VITE_AUTH0_ORG_ID` | Optional | `org_123` | `scripts/generate-auth0-config.mjs` | Organization id (preferred over slug). |
| `VITE_AUTH0_ORG_SLUG` | Optional | `hulmose` | `scripts/generate-auth0-config.mjs` | Organization slug (fallback). |
| `VITE_AUTH0_ORGANIZATION_ID` | Optional | `org_123` | `scripts/generate-auth0-config.mjs` | Legacy alias, still published. |
| `VITE_AUTH0_ORGANIZATION_SLUG` | Optional | `hulmose` | `scripts/generate-auth0-config.mjs` | Legacy alias, still published. |
| `VITE_ADMIN_EMAIL` | Optional | `admin@example.com` | `scripts/generate-auth0-config.mjs` | Default admin bootstrap email for UI. |
| `VITE_ADMIN_EMAILS` | Optional | `a@example.com,b@example.com` | `scripts/generate-auth0-config.mjs` | Extra admin allow list. |
| `VITE_AUTH0_REDIRECT_URI` | Optional | `https://app.sscaff.app/callback` | `scripts/generate-auth0-config.mjs` | Override Auth0 callback. |
| `VITE_E2E_BYPASS_AUTH` | Optional | `1` | `scripts/generate-auth0-config.mjs` | E2E-only bypass, blocked in production. |
| `VITE_BUILD_TIME` | Optional | `2025-01-20T05:47:00Z` | `scripts/generate-version.js` | Build stamp for UI version. |
| `VITE_GIT_SHA` | Optional | `abcdef1` | `scripts/generate-version.js` | Build sha for UI version. |

## Netlify Functions / backend
| Variable | Required | Example | Where used | Notes |
| --- | --- | --- | --- | --- |
| `AUTH0_DOMAIN` | Optional | `example.eu.auth0.com` | `netlify/functions/_auth.mjs`, `netlify/functions/api.mjs`, `netlify/functions/org-members.mjs` | Used to resolve issuer/management API when provided. |
| `AUTH0_ISSUER` | Yes | `https://example.eu.auth0.com/` | `netlify/functions/_auth.mjs` | Token issuer for verification (normalized with trailing slash). |
| `AUTH0_AUDIENCE` | Yes | `https://api.sscaff.app` | `netlify/functions/_auth.mjs` | Token audience for verification. |
| `AUTH0_MGMT_AUDIENCE` | Optional | `https://example.eu.auth0.com/api/v2/` | `netlify/functions/api.mjs`, `netlify/functions/org-members.mjs` | Override Auth0 management API audience. |
| `AUTH0_MGMT_CLIENT_ID` | Optional | `abc123` | `netlify/functions/api.mjs`, `netlify/functions/org-members.mjs` | Auth0 management client id (required for management calls). |
| `AUTH0_MGMT_CLIENT_SECRET` | Optional | `secret` | `netlify/functions/api.mjs`, `netlify/functions/org-members.mjs` | Auth0 management client secret (required for management calls). |
| `DEFAULT_TEAM_SLUG` | Optional | `hulmose` | `netlify/functions/api.mjs` | Default team slug fallback. |
| `APP_ORIGIN` | Optional | `https://app.sscaff.app` | `netlify/functions/api.mjs` | Used to build invite URLs. |
| `APP_BASE_URL` | Optional | `https://app.sscaff.app` | `netlify/functions/api.mjs` | Legacy fallback for invite URLs. |
| `EMAIL_FROM` | Optional | `no-reply@sscaff.app` | `netlify/functions/api.mjs` | Sender address for invites. |
| `EMAIL_PROVIDER_API_KEY` | Optional | `re_...` | `netlify/functions/api.mjs` | Resend API key for invites. |
| `DATABASE_URL` | Yes | `postgresql://user:pass@host/db` | `netlify/functions/_db.mjs` | Primary DB connection. |
| `DATABASE_URL_UNPOOLED` | Optional | `postgresql://...` | `netlify/functions/_db.mjs` | Unpooled connection fallback. |
| `DATABASE_SSL` | Optional | `require` | `netlify/functions/_db.mjs` | Force SSL mode (true/false/require). |

## Build / CI / tooling
| Variable | Required | Example | Where used | Notes |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | Optional | `production` | `scripts/generate-auth0-config.mjs`, `tools/verify-auth0-production.mjs` | Build/verify mode. |
| `CONTEXT` | Optional | `production` | `scripts/generate-auth0-config.mjs`, `tools/verify-auth0-production.mjs` | Netlify context. |
| `NETLIFY_CONTEXT` | Optional | `production` | `scripts/generate-version.js` | Netlify context. |
| `NETLIFY` | Optional | `true` | `scripts/prepare-playwright.js` | Skip browser install in Netlify. |
| `URL` | Optional | `https://app.sscaff.app/` | `scripts/generate-version.js` | Published URL metadata. |
| `COMMIT_REF` | Optional | `abcdef` | `scripts/generate-version.js`, `scripts/bump-sw-version.js` | Commit sha. |
| `GIT_COMMIT_SHA` | Optional | `abcdef` | `scripts/generate-version.js` | Commit sha fallback. |
| `GITHUB_SHA` | Optional | `abcdef` | `scripts/bump-sw-version.js` | Commit sha fallback. |
| `SHA` | Optional | `abcdef` | `scripts/bump-sw-version.js` | Commit sha fallback. |
| `PORT` | Optional | `4173` | `scripts/serve-with-headers.js` | Local dev server port. |
| `CSSMATE_IS_CI` | Optional | `1` | `scripts/serve-with-headers.js`, `src/config/runtime-modes.js`, `tools/check-lighthouse-perfect.mjs` | CI flag for behavior and checks. |
| `CI` | Optional | `true` | `src/config/runtime-modes.js`, `tools/check-lighthouse-perfect.mjs`, `tools/repo-scan.mjs` | CI flag. |
| `PLAYWRIGHT_SKIP_PREPARE` | Optional | `1` | `scripts/prepare-playwright.js` | Skip browser install. |
| `PLAYWRIGHT_PREPARE_BROWSER` | Optional | `chromium` | `scripts/prepare-playwright.js` | Browser to install. |
| `PLAYWRIGHT_PREPARE_WITH_DEPS` | Optional | `1` | `scripts/prepare-playwright.js` | Install dependencies. |
| `VERIFY_SERVER_PORT` | Optional | `4173` | `tools/verify/run-with-server.js` | Verify server port. |
| `VERIFY_SERVER_URL` | Optional | `http://127.0.0.1:4173` | `tools/verify/run-with-server.js` | Verify server URL. |
| `CHROME_PATH` | Optional | `/usr/bin/google-chrome` | `tools/verify/run-with-server.js`, `tools/run-lh-mobile-3x.mjs` | Lighthouse binary override. |
| `CHROME_BIN` | Optional | `/usr/bin/chromium` | `tools/verify/run-with-server.js`, `tools/run-lh-mobile-3x.mjs` | Lighthouse binary fallback. |
| `LHCI_URL` | Optional | `http://127.0.0.1:4173` | `tools/verify/run-with-server.js` | Lighthouse URL. |
| `LH_PERFORMANCE_SCORE` | Optional | `≥0.95` | `tools/verify/summary.js` | Lighthouse score threshold. |
| `CSSMATE_LH_PERF_MIN` | Optional | `95` | `tools/check-lighthouse-perfect.mjs`, `tools/lh-enforce.js` | Lighthouse perf minimum. |
| `CSSMATE_LH_PERF_TARGET` | Optional | `100` | `tools/check-lighthouse-perfect.mjs` | Lighthouse perf target. |
| `CSSMATE_LH_LCP_MAX_MS` | Optional | `3000` | `tools/check-lighthouse-perfect.mjs` | LCP threshold. |
| `CSSMATE_LH_CLS_MAX` | Optional | `0.01` | `tools/check-lighthouse-perfect.mjs` | CLS threshold. |
| `LIGHTHOUSE` | Optional | `1` | `src/config/runtime-modes.js` | Runtime flag for LH mode. |
