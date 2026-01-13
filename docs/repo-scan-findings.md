# Repo scan findings

Last updated: 2026-01-13T17:46:30Z

## How to run

- Install deps: `npm ci`
- Run scans: `node tools/repo-scan.mjs`

> Scan outputs are written to `reports/repo-scan/` locally and are gitignored.

## Findings

| ID | Category | Summary | File(s) | Command | Status | Fix commit |
| --- | --- | --- | --- | --- | --- | --- |
| RS-001 | Perf | `perf:bundle` failed (CSS bundle over limit). | `package.json` | `npm run perf:bundle` | RESOLVED | - |
| RS-002 | Lighthouse | `lh:mobile` failed due to missing Chrome/Chromium. | `.lighthouserc.json` | `npm run lh:mobile` | OPEN | - |
