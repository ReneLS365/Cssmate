# Performance Report

## Before / After scores
- **Before:** Not available locally (Chrome/Chromium missing). `docs/lighthouse/latest-mobile.json` contains zeroed scores.
- **After:** Not measured locally yet. Please re-run `npm run test:lh:mobile` or `npm run lh:mobile` once Chrome is available.

## Changes that impact performance and Best Practices
1. **CSP enforcement via Netlify headers** (Best Practices fix, no runtime cost).
2. **Removed inline JS handlers in `<link>` tags** to satisfy CSP and reduce blocking.
3. **Externalized import map** to avoid inline scripts and keep CSP strict.
4. **Deferred non-critical bootstrap scripts** (`firebase-env.js`, `version.js`) to reduce initial parse/execute blocking.
5. **Service worker precache updated** for new import map to preserve offline behavior.
6. **Deferred admin-code fetch to idle** to reduce startup work before first paint.
7. **Lazy-init A9 integration** on first visit to the Løn tab to keep initial JS lighter.

## Expected Lighthouse impact
- **Best Practices:** Should move to 100 (charset + CSP).
- **Performance:** Slight improvement in LCP/TBT due to deferred sync scripts and reduced blocking in head, plus reduced startup work from admin fetch/A9 setup.

## Remaining audits (if any)
- Re-run Lighthouse to confirm any remaining audits once Chrome is available.
