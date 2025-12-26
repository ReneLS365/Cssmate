# Performance Baseline

## Lighthouse capture
- Status: **not run locally** (Chrome/Chromium binary not available in this environment).
- Existing report `docs/lighthouse/latest-mobile.json` appears to be an error-only report (all category scores are `0`).

## Known failing audits (from task requirements / observed issues)
1. **Best Practices: Properly defines charset** (missing/invalid/late charset meta).
2. **Best Practices: Content Security Policy (CSP)** missing.
3. **Performance: Render-blocking resources** (multiple async CSS `onload` patterns).
4. **Performance: Unused JS/CSS** (module + deferred scripts without splitting).
5. **Performance: Main-thread work at startup** (auth + team listeners at load).

> Re-run Lighthouse locally or in CI once Chrome is available to capture real baseline scores.
