# Audit command summary

## Environment
- **Package manager:** npm
- **Node version requirement:** >=22 <23 (from `package.json`)
- **Local Node version:** v20.19.6 (npm reported engine mismatch warnings).

## Commands
- `npm ci`
  - Result: ✅ Completed with engine warnings (Node 20 vs >=22) and 1 low-severity audit warning.
- `npm run lint`
  - Result: ✅ Passed (`html-validate` on `index.html`).
- `npm test`
  - Result: ✅ Passed after guarding DOM access in `js/akkord-export-ui.js`.
- `npm run build`
  - Result: ✅ Passed (prebuild checks + staging).
- `npm run test:e2e`
  - Result: ⚠️ Failed to launch Chromium due to missing `libatk-1.0.so.0` in the environment.

## Security scan notes
- `rg --files -g '.env*'` detected a tracked `.env`; it has been removed from git and added to `.gitignore`.
- `rg -n "BEGIN PRIVATE KEY|PRIVATE KEY"` matched only the guard script patterns.
- `rg -n "apiKey|apikey|secret"` matched documentation and tooling references (no secret values).
