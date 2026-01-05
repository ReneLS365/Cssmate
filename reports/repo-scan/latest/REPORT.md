# Repo Scan Report (2026-01-05T16-14-15-437Z)

## Environment

- OS: Linux 6.12.13
- Node: v20.19.5
- npm: 11.4.2
- CPU: Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz (3 cores)

## Repo inventory

- Tracked files: 218
### Top extensions
- .js: 122
- .md: 26
- .mjs: 14
- .json: 11
- .ts: 10
- no-ext: 9
- .css: 7
- .yml: 4
- .xlsx: 3
- .html: 2
- .png: 2
- .sh: 2

## Commands executed

| Scan | Command | Exit code | Output |
| --- | --- | --- | --- |
| Repo status | `git status --porcelain` | 0 | `01-repo-status.stdout.log`<br>`01-repo-status.stderr.log` |
| Repo inventory | `git ls-files` | 0 | `02-git-ls-files.stdout.log`<br>`02-git-ls-files.stderr.log` |
| Install integrity (npm ci) | `npm ci` | — | SKIPPED (not running in CI; set REPO_SCAN_NPM_CI=true to enable) |
| Build | `npm run build` | 1 | `04-build.stdout.log`<br>`04-build.stderr.log` |
| Unit tests | `npm test` | 0 | `05-tests.stdout.log`<br>`05-tests.stderr.log` |
| Lint | `npm run lint` | 0 | `06-lint.stdout.log`<br>`06-lint.stderr.log` |
| Formatting check | `npm run format:check` | — | SKIPPED (not configured) |
| Dependency audit | `npm audit --json` | 0 | `08-audit.stdout.log`<br>`08-audit.stderr.log` |
| License inventory | `npm run license` | — | SKIPPED (not configured) |
| Bundle analysis | `npm run perf:bundle` | 1 | `10-analyze.stdout.log`<br>`10-analyze.stderr.log` |
| Lighthouse | `npm run lh:mobile` | 1 | `11-lighthouse.stdout.log`<br>`11-lighthouse.stderr.log` |
| Dead code scan | `npm run knip` | — | SKIPPED (not configured) |
| Secrets scan | `npm run guard:secrets` | 0 | `13-secrets.stdout.log`<br>`13-secrets.stderr.log` |
| CSP/headers checks | `npm run verify:headers` | — | SKIPPED (not configured) |
| Code pattern scan | `node tools/repo-scan.mjs (patterns)` | 0 | `code-patterns.json`<br>`code-patterns.md` |

## Key findings

### Non-zero exit codes
- Build: exit 1
- Bundle analysis: exit 1
- Lighthouse: exit 1

### Code pattern totals
- TODO: 8
- FIXME: 3
- HACK: 0
- console.error: 72
- console.warn: 114
- eval(: 0
- dangerouslySetInnerHTML: 0
- apiKey: 36
- FIREBASE: 415

## Raw logs

See `reports/repo-scan/2026-01-05T16-14-15-437Z` for full logs.
