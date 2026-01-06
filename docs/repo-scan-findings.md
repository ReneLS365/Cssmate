# Repo scan findings

Last updated: 2026-01-06T00:09:08Z

## How to run

- Install deps: `npm ci`
- Run scans: `node tools/repo-scan.mjs`

> Scan outputs are written to `reports/repo-scan/` locally and are gitignored.

## Findings

| ID | Category | Summary | File(s) | Command | Status | Fix commit |
| --- | --- | --- | --- | --- | --- | --- |
| RS-001 | Build | Missing Firebase env vars for build. | `tools/verify-firebase-env.mjs` | `npm run build` | OPEN | - |
| RS-002 | Tests | Missing dev dependency during tests (`pdf-lib`). | `tests/export-files.test.js` | `npm test` | OPEN | - |
| RS-003 | Lint | Missing dev dependency (`html-validate`). | `package.json` | `npm run lint` | OPEN | - |
| RS-004 | Perf | Missing dev dependency (`size-limit`). | `package.json` | `npm run perf:bundle` | OPEN | - |
| RS-005 | Lighthouse | Missing dev dependency (`lighthouse`). | `package.json` | `npm run lh:mobile` | OPEN | - |
