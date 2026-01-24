# REVIEW TODAY — PR #371, #372, #373, #374 + Repo Forensic Review

_Date:_ 2026-01-24  
_Reviewer:_ Codex (forensic-level review, **no fixes implemented**)  
_Source of truth:_ Local repository at `/workspace/Cssmate`

---

## Review constraints & provenance (important)

### PR access limitations
I could not access GitHub PR metadata directly because:
- `gh` CLI is not installed.
- No git remote is configured in this environment.

Therefore, PR #371–#374 are reviewed based on local git history and commit messages that explicitly reference the PR numbers:

- `9448f23` — “Fix preview write gating and Auth0 member registration (#371)”
- `71adb3b` — “Fix Netlify context gating and Auth0 member upserts (#372)”
- `e0ea2a3` — “Fix Netlify SPA redirect warning (#373)”
- `03592eb` — “Harden deploy context resolution for production hostnames (#374)”

Command used:
- `git log --since=midnight --name-status`

### ZIP instruction limitation
The task asked me to unzip a provided ZIP into a clean folder. No ZIP file was present in this environment, so I reviewed the repo in-place and avoided committing any build artifacts.

---

# Phase 1 — Baseline setup & diagnostics

## Runtime & deploy baseline (recorded)

### Node version contract
- Netlify build environment: `NODE_VERSION = "22"`.
- `package.json` engines: `>=22 <23`.
- `.nvmrc`: `22`.

### Build/publish/functions baseline
- Build command: `npm run build`.
- Publish directory: `.netlify_publish`.
- Functions directory: `netlify/functions`.
- Functions bundler: Netlify default (zisi/bundled functions).

---

## Commands executed + outcomes (with key excerpts)

### Install
- Command: `npm ci`
- Result: ✅ Succeeded with engine warnings.
- Notable excerpt:
  - Node mismatch warning: current Node is `v20.19.6` while engines require Node 22.

### Build
- Command: `npm run build`
- Result: ✅ Succeeded.
- Notable excerpt:
  - Prebuild guards passed (Auth0 config, secret guard, inline handler guard).
  - Service worker build id was bumped during the build, but the file was reverted to avoid committing generated artifacts.

### Unit / integration tests
- Command: `npm test`
- Result: ✅ Succeeded (106 tests, 0 failures).
- Notable excerpts:
  - Some Playwright-dependent tests were skipped.
  - A `MutationObserver is not defined` warning appears in the Node test environment but does not fail tests.

### Lint
- Command: `npm run lint`
- Result: ✅ Succeeded (`html-validate index.html`).

### Typecheck
- Command: `npm run typecheck --if-present`
- Result: ✅ No `typecheck` script is defined; the command exits cleanly.

### Security audit
- Command: `npm audit --production`
- Result: ✅ 0 production vulnerabilities.

Additional (not required but useful):
- Command: `npm audit`
- Result: ⚠️ 1 moderate vulnerability (in `undici` via dev dependency chain).

### Dependency hygiene (depcheck)
- Command: `npx depcheck`
- Result: ⚠️ Completed with a non-zero exit code and several likely false positives due to vendor files and npx-style scripts.
- Notable findings:
  - Reported unused dependency: `@auth0/auth0-spa-js`.
  - Reported missing dependency: `@fireproof/partykit` (referenced by `src/partykit/server.ts`).
  - Reported missing dependencies inside vendored files (expected false positives).

### Bundle size contract
- Command: `npm run perf:bundle`
- Result: ❌ Failed.
- Notable excerpt:
  - `styles` exceeded limit: 10.37 kB gzipped vs 10 kB limit.

### E2E tests
- Command: `npm run test:e2e`
- Result: ⚠️ Failed due to missing system libraries for Playwright Chromium (`libatk-1.0.so.0`).
- This appears to be an environment limitation, not necessarily a code regression.

### Lighthouse (mobile)
- Command: `npm run lh:mobile`
- Result: ⚠️ Failed due to missing Chrome/Chromium binary in the environment.

---

# Phase 2 — Pull request review (#371–#374)

## PR #371 — Fix preview write gating and Auth0 member registration

### Title / intent (inferred)
The PR attempts to:
1. Prevent writes in preview deployments on the client.
2. Auto-register an Auth0 member row.
3. Introduce deploy-context utilities and tests.

### Files touched (from local git)
- `netlify.toml`
- `src/lib/deploy-context.js`
- `src/services/team-members.js`
- `src/auth/session.js`
- `src/ui/team-admin-page.js`
- `js/shared-ledger.js`
- `js/shared-cases-panel.js`
- `src/lib/auth0-user.js`
- `tests/deploy-context.test.js`

### Why these files matter
- `netlify.toml` + `deploy-context.js` together define preview/production gating behavior.
- `team-members.js` + `session.js` define the member upsert path.
- `shared-ledger.js` gates all shared-case writes on the client.

---

### Risk rating: **HIGH**

### Regressions / risks identified

#### 1) Production can be misdetected as non-production (blocker)
**Evidence:** PR #371 adds this to `netlify.toml`:

```toml
[build.environment]
  VITE_NETLIFY_CONTEXT = "${CONTEXT}"
```

On non-Netlify builds (and sometimes in Netlify config resolution), this can become the literal string `${CONTEXT}`. The PR #371 version of `deploy-context.js` treats _any non-empty env context_ as authoritative. That makes:
- `envContext = "${context}"`
- `isProduction = false`
- `isPreview = false`
- `writesAllowed = false`

This matches the reported symptom: “Writes disabled in preview deployments” appearing on production.

#### 2) Client-side gating becomes authoritative too early
The `ensureWritesAllowed(...)` gate in `js/shared-ledger.js` is called before network requests. If deploy-context is wrong, all write flows are blocked even when the server would otherwise allow them.

---

### Required fixes before merge
Even though later PRs address parts of this, PR #371 alone is **NOT READY** due to:
1. `VITE_NETLIFY_CONTEXT = "${CONTEXT}"` is unsafe.
2. `deploy-context.js` needs sanitization of placeholder env values.
3. A guard should exist that fails builds if placeholder env values are embedded.

### Merge readiness verdict: **NOT READY**
Reason: Production write gating can be broken by env placeholder resolution.

---

## PR #372 — Fix Netlify context gating and Auth0 member upserts

### Title / intent (inferred)
This PR aims to fix PR #371’s context problems and improve member upserts and migrations.

Key goals:
- Move Netlify context gating into context blocks.
- Sanitize deploy context values.
- Upsert Auth0 members more robustly.
- Add migration 008 for member profile fields.

### Files touched (from local git)
- `netlify.toml`
- `src/lib/deploy-context.js`
- `netlify/functions/_db.mjs`
- `netlify/functions/api.mjs`
- `netlify/functions/migrate.mjs`
- `netlify/functions/migrations/008_auth0_member_profile.sql`
- `src/services/teams.js`
- `src/ui/team-admin-page.js`
- `tests/deploy-context.test.js`
- `tests/membership-path.test.js`
- Plus supporting docs and lockfile changes.

---

### Risk rating: **HIGH**

### What PR #372 improves
1. **Netlify context handling is much safer**:
   - Removes `${CONTEXT}` embedding.
   - Uses `[context.*.environment]` blocks.
2. **Deploy context is sanitized**:
   - Placeholder values like `${context}`, `undefined`, and `null` are ignored.
3. **Member upsert logic is improved**:
   - Uses `user_sub` consistently.
   - Adds `display_name` and `last_seen_at`.

---

### Regressions / risks identified

#### 1) Preview environments can still run migrations (BLOCKER)
**Evidence chain:**
- `handler()` blocks writes in preview using `isProd()`.
- However, many _read routes_ call `requireDbReady(event)`.
- `requireDbReady(event)` calls `ensureDbReady()`.
- `ensureDbReady()` calls `ensureMigrations()`.
- `ensureMigrations()` runs **write operations** and executes migrations.

This means deploy previews can still execute migrations (including `DROP TABLE users`) on the configured database, even when writes are “blocked.” This violates the preview safety contract at the most critical layer.

#### 2) Team members list does not self-heal missing membership rows (HIGH)
**Evidence:**
- `handleTeamMembersList()` for non-privileged users:
  - checks membership with `getMember(...)`
  - returns `[]` if no row exists
  - does not call `upsertMemberFromUser(...)`

If the client-side registration is blocked (or fails once), the Team page will show no members, even though the token is valid.

#### 3) `ensureTeam(...)` writes on every request in production (MEDIUM)
`ensureTeam()` uses `INSERT ... ON CONFLICT DO UPDATE` for every request. This creates write amplification even for read-only requests.

#### 4) Migration 008 drops `users` table without explicit safety guard (MEDIUM)
This may be intentional, but doing it automatically on request-driven migration execution is risky, especially combined with the preview-migration problem.

---

### Required fixes before merge
PR #372 is **NOT READY** until the following are addressed:
1. Prevent auto-migrations from running in non-production contexts.
2. Ensure `/teams/:teamId/members` upserts the calling user when missing (in production).
3. Reduce write amplification from `ensureTeam(...)`.

### Merge readiness verdict: **NOT READY**
Reason: preview safety contract can be violated by auto-migrations on read routes.

---

## PR #373 — Fix Netlify SPA redirect warning

### Title / intent (inferred)
Remove an invalid redirect that triggers `/:splat` errors/warnings.

### Files touched
- `netlify.toml`

### Risk rating: **LOW**

### Regressions / risks identified
I did not find regressions in this change. The removed redirect was:

```toml
[[redirects]]
  from = "//*"
  to = "/:splat"
  status = 301
  force = true
```

That rule is invalid and can produce the reported `/ :splat` error. The removal is correct.

### Required fixes before merge
None identified.

### Merge readiness verdict: **READY**

---

## PR #374 — Harden deploy context resolution for production hostnames

### Title / intent (inferred)
Force production hostnames to be treated as production even if env context is wrong.

### Files touched
- `src/lib/deploy-context.js`

### Risk rating: **MEDIUM** (because it directly gates writes)

### What PR #374 improves
- Production hostname (`sscaff.netlify.app`) now overrides env context values.
- This is a strong mitigation for the incident where production was treated as preview.

### Regressions / risks identified

#### 1) Production host allowlist is incomplete (HIGH, but not necessarily blocking)
`PROD_HOSTS` only includes `sscaff.netlify.app`. If production also runs on a custom domain, and env context is wrong, the custom domain can still be treated as preview.

#### 2) Missing a regression test for “preview env on prod host” (MEDIUM)
There is no explicit test asserting that `envContext = deploy-preview` on a known production hostname still allows writes.

---

### Required fixes before merge
None that are strictly blocking in the current repo state, but I strongly recommend:
1. Externalizing production hostnames to env configuration.
2. Adding explicit regression tests for prod-host overrides.

### Merge readiness verdict: **READY** (with follow-up backlog items)

---

# Phase 3 — Deep repo research (beyond PRs)

## 3A) Architecture map + invariants (with file pointers)

### Auth flow (Auth0-only)
Client side:
- `js/shared-auth.js`
- `src/auth/auth0-client.js`
- `src/auth/session.js`
- `src/lib/auth0-user.js`

Server side verification:
- `netlify/functions/_auth.mjs`
- `netlify/functions/api.mjs` (`requireAuth(...)`)

Key invariant confirmed:
- Auth is Auth0-based and tokens are verified server-side via `jose.jwtVerify`.

---

### API layer (Netlify Functions)
- Primary: `netlify/functions/api.mjs`
- Context helper: `netlify/functions/_context.mjs`
- DB helper: `netlify/functions/_db.mjs`
- Log sanitizer: `netlify/functions/_log.mjs`

Client API wrapper:
- `src/api/client.js`
- Consumers:
  - `js/shared-ledger.js`
  - `src/services/team-members.js`
  - `src/ui/team-admin-page.js`

---

### Persistence (Neon/Postgres-only)
- DB access: `netlify/functions/_db.mjs`
- Schema: `netlify/functions/migrations/*.sql`
- All server queries are parameterized (`$1`, `$2`, ...).

---

### Preview/production gating logic (client + server)
Client:
- `src/lib/deploy-context.js`
- Used by:
  - `js/shared-ledger.js`
  - `src/services/team-members.js`
  - `src/ui/team-admin-page.js`

Server:
- `netlify/functions/_context.mjs` (`isProd()`)
- Gating in `netlify/functions/api.mjs` handler:
  - `if (!isProduction && isWriteMethod) return 403`

Config:
- `netlify.toml` context blocks set `VITE_NETLIFY_CONTEXT` per context.

---

### Export/import flows (JSON/PDF/ZIP)
Primary modules:
- `js/export-model.js`
- `js/export-json.js`
- `js/export-pdf.js`
- `js/export-zip.js`
- `js/import-akkord.js`

Tests exist for these flows under `tests/*export*.test.js` and `tests/import-akkord.test.js`.

---

### Team/membership model (Auth0 `sub`, default teamId = hulmose)
Default team id:
- Client: `src/services/team-ids.js` (`hulmose`)
- Server: `netlify/functions/api.mjs` (`DEFAULT_TEAM_SLUG || 'hulmose'`)

Membership keyed on `sub`:
- Server: `upsertMemberFromUser(teamId, user)` uses `user.id = payload.sub`
- DB schema uses `team_members(team_id, user_sub)`.

---

## 3B) Security scan (explicit)

### Commands run
- `rg -n -S "PASSWORD|SECRET|API_KEY|Bearer |DATABASE_URL|postgres://" -g "!node_modules/**" -g "!.git/**"`
- `rg --files -g ".env*" -g "!node_modules/**" -g "!.git/**"`
- `rg -n "console\.(log|warn|error|info)" netlify/functions -S`

### Findings

#### ✅ No obvious committed secrets
- No `.env` files were found.
- Secret-like strings appear only as env var references or documentation.

#### ✅ Token verification appears correct
- `jose.jwtVerify` with issuer + audience is used.
- JWKS is fetched from Auth0 domain.

#### ⚠️ High-risk behavior: preview contexts can still perform writes via migrations
Even if writes are blocked at the handler, the DB migration runner still executes on read routes. This is a security/safety issue (see backlog item F-001).

---

## 3C) Data integrity & Postgres correctness

### What looks good
- All queries reviewed are parameterized.
- Team scoping appears consistent (`WHERE team_id = $1`).
- Soft delete is respected (`deleted_at IS NULL` in list queries).
- Pagination is server-side with cursor.
- Indices for large case sets exist (`005`, `007`).

### Data-integrity concerns

#### 1) Auto-migrations on request path (blocker)
Migrations run on request-path initialization. Combined with preview contexts, this can mutate the wrong database.

#### 2) Member row creation relies too much on client
`/teams/:teamId/members` does not upsert missing self membership for normal users. This is fragile and can explain “Team page not showing members.”

#### 3) `ensureTeam()` write amplification
Read requests still write to `teams` due to upsert on every call.

---

## 3D) Deploy correctness (Netlify)

### What is correct
- SPA fallback uses `/index.html` with status 200.
- API redirect precedes SPA fallback:
  - `/api/* -> /.netlify/functions/api/:splat` is above `/* -> /index.html`.
- Publish directory is staged (`.netlify_publish`).

### Deploy risks identified

#### 1) Preview safety contract can be violated by request-driven migrations (blocker)
This is the most severe deploy risk found.

#### 2) Size-limit gate currently fails
`npm run perf:bundle` fails due to CSS size exceeding the configured limit.

---

## 3E) Dead code / legacy removal candidates (documented only)

### Candidate: PartyKit / Fireproof remnants
Evidence:
- `src/partykit/server.ts` imports `@fireproof/partykit/server`.
- `partykit.json` expects a local `node_modules/@fireproof/partykit/server.js`.
- `@fireproof/partykit` is not present in `package.json`.

This is either:
- dead code, or
- an incomplete integration.

This is a good cleanup target, but should be handled carefully and only after usage is proven absent.

---

## 3F) Performance / UX hot spots

### Hot spots identified
1. **Auto-migrations on cold start** — heavy, and it writes.
2. **Team ensure upsert on every request** — write amplification.
3. **Member registration not truly “once”** — repeated POSTs per session.
4. **Bundle size gate failing** — CSS is now over the limit.

---

# Special focus checks (root-cause analysis)

## 1) “Writes disabled in preview deployments” appearing on production

### Root cause chain (most likely)
1. PR #371 embedded `VITE_NETLIFY_CONTEXT = "${CONTEXT}"`.
2. The deploy context reader treated any non-empty env context as authoritative.
3. `${context}` becomes a non-empty string that is not `production`.
4. Client-side gating blocks all writes before the request is made.

### Confirmed mitigations present
- PR #372 removed `${CONTEXT}` and added sanitization.
- PR #374 ensures known production hosts override env context.

### Remaining hardening gaps
- Production host allowlist is incomplete.
- There is no guardrail that fails builds when placeholder env values are embedded.

---

## 2) Team page not showing members

### Likely root causes

#### Root cause A — client gating blocks member upsert
If deploy context is wrong, `/members/self` is never called.

#### Root cause B — server members list does not upsert self
For non-privileged users, `/teams/:teamId/members`:
- does not call `upsertMemberFromUser(...)` when missing
- returns an empty list

This is a correctness gap and should be fixed server-side.

---

## 3) Redirect error `/ :splat`

### Finding
The problematic redirect rule was removed in PR #373:

```toml
from = "//*"
to = "/:splat"
```

### Verdict
- Current SPA fallback is correct.
- API redirect precedence appears correct.

---

# Findings Backlog (for next task)

Each item below is copy/paste-ready as a new task.

---

## F-001 — Block preview contexts from running automatic DB migrations
- **Severity:** Blocker  
- **Scope:** PR372 / Repo-wide

### Context
Write-guards are implemented in the request handler, but the DB initialization path still runs migrations on read routes.

### Evidence
- `netlify/functions/api.mjs`: read routes call `requireDbReady(event)`.
- `requireDbReady(event)` calls `ensureDbReady()`.
- `ensureDbReady()` calls `ensureMigrations()`.
- Migrations include destructive changes (e.g., drop `users`).

### Exact file paths
- `netlify/functions/api.mjs`
- `netlify/functions/_db.mjs`
- `netlify/functions/migrations/008_auth0_member_profile.sql`

### Fix plan (exact approach)
1. In `_db.mjs`, guard `ensureMigrations()` behind production context only (or behind an explicit env flag like `ALLOW_DB_MIGRATIONS=true`).
2. In non-production contexts:
   - skip running migrations automatically
   - optionally perform a **read-only** readiness check
3. Ensure that the explicit migration endpoint (`migrate.mjs`) remains the only way to run migrations outside production.

### Commands to validate
- `npm test`
- `npm run build`
- Manual:
  - In deploy-preview context, call a GET endpoint and verify no migration writes occur.

### Acceptance criteria
- In deploy previews and branch deploys, GET requests must not execute migrations.
- If preview env accidentally points to production DB, no schema mutations occur from preview traffic.

---

## F-002 — Self-heal missing member rows on `/teams/:teamId/members` for normal users
- **Severity:** High  
- **Scope:** PR372 / Repo-wide

### Context
Normal users can receive an empty members list if the member row was never created (or if registration was blocked once).

### Evidence
For non-privileged users, `handleTeamMembersList()` checks membership but does not upsert when missing.

### Exact file paths
- `netlify/functions/api.mjs` (`handleTeamMembersList`)

### Fix plan (exact approach)
1. In production context, when `getMember(...)` returns null:
   - call `upsertMemberFromUser(team.id, user)`
   - then return the serialized row
2. Keep current preview behavior (ephemeral member) unchanged.

### Commands to validate
- `npm test`
- Add targeted unit tests for:
  - missing member → upserted member is returned
  - preview context remains read-only

### Acceptance criteria
- A valid Auth0 user without a row in `team_members` should see themselves after loading the Team page once in production.
- The fix must not enable writes in deploy previews.

---

## F-003 — Add a production-host override test for preview env values
- **Severity:** Medium  
- **Scope:** PR374

### Context
Deploy context correctness is critical to avoiding production outages.

### Evidence
There is no explicit test covering:
- production hostname
- env context = `deploy-preview`
- expected outcome: production wins

### Exact file paths
- `src/lib/deploy-context.js`
- `tests/deploy-context.test.js`

### Fix plan (exact approach)
Add a test case:
- hostname: `sscaff.netlify.app`
- env: `{ VITE_NETLIFY_CONTEXT: 'deploy-preview' }`
- assert: `writesAllowed === true`, `context === 'production'`

### Commands to validate
- `npm test`

### Acceptance criteria
- The new test fails on regression and passes with the intended override behavior.

---

## F-004 — Externalize production host allowlist for deploy-context gating
- **Severity:** High  
- **Scope:** PR374 / Repo-wide

### Context
Only one production hostname is hardcoded. If production uses a custom domain, context gating may still break.

### Evidence
- `PROD_HOSTS` includes only `sscaff.netlify.app`.

### Exact file paths
- `src/lib/deploy-context.js`
- `netlify.toml`
- `docs/ENV.md` (or similar)

### Fix plan (exact approach)
1. Add an env var such as `VITE_PROD_HOSTS` (comma-separated hostnames).
2. Parse it in `deploy-context.js` and merge it into `PROD_HOSTS`.
3. Document the variable in env docs.
4. Add tests for:
   - multiple prod hosts
   - env preview values on prod hosts

### Commands to validate
- `npm test`
- `npm run build`

### Acceptance criteria
- Production hostnames are configuration-driven and tested.
- Production hostnames always resolve to `writesAllowed = true`.

---

## F-005 — Make `registerTeamMemberOnce` actually “once per session”
- **Severity:** Medium  
- **Scope:** PR371 / Repo-wide

### Context
`registerTeamMemberOnce(...)` only prevents parallel calls. It still performs repeated POST requests across the session.

### Evidence
- `registrationPromise` is cleared in `.finally()`.
- `registrationKey` remains the same, but there is no “already succeeded” state.

### Exact file paths
- `src/services/team-members.js`

### Fix plan (exact approach)
1. Track a `registrationCompletedKey` (or success timestamp).
2. If the key matches and success is recent, skip the POST.
3. Provide a `force` option to override when needed (e.g., role change).

### Commands to validate
- `npm test`
- Add unit tests to ensure repeated calls do not re-POST for the same key.

### Acceptance criteria
- Repeated calls with the same key do not issue network writes in the same session.
- Role changes still allow re-registration.

---

## F-006 — Remove write amplification from `ensureTeam(...)` on read requests
- **Severity:** Medium  
- **Scope:** PR372 / Repo-wide

### Context
`ensureTeam(...)` performs `INSERT ... ON CONFLICT DO UPDATE` on every request in production.

### Evidence
- `ensureTeam(...)` is called on read routes.
- On conflict it still performs an UPDATE.

### Exact file paths
- `netlify/functions/api.mjs`

### Fix plan (exact approach)
1. Use `INSERT ... ON CONFLICT DO NOTHING RETURNING ...`.
2. If no row returned, run a follow-up `SELECT`.
3. Keep preview behavior as-is.

### Commands to validate
- `npm test`
- Manual: confirm team still auto-creates on first use.

### Acceptance criteria
- Read requests do not write to `teams` when the team already exists.
- First-time team creation still works in production.

---

## F-007 — Protect preview contexts from using production databases (fail-fast guard)
- **Severity:** High  
- **Scope:** Repo-wide / Deploy safety

### Context
The preview safety contract says preview env vars must not point to production DB. The code currently does not enforce this.

### Evidence
- `_db.mjs` resolves `DATABASE_URL` without context-aware host validation.

### Exact file paths
- `netlify/functions/_db.mjs`
- `netlify/functions/_context.mjs`
- `docs/ENV.md`

### Fix plan (exact approach)
1. Parse DB host from `DATABASE_URL`.
2. In non-production contexts, compare against a production host allowlist.
3. If a production host is detected in preview, fail-fast with a clear error.

### Commands to validate
- `npm test`
- Manual: simulate preview context with production DB host and verify a safe failure.

### Acceptance criteria
- Preview deployments cannot run against production DB silently.
- Failure mode is explicit and actionable.

---

## F-008 — Add safety guard before dropping legacy `users` table
- **Severity:** Medium  
- **Scope:** PR372 / Repo-wide

### Context
Migration 008 drops `users`. This is risky if previews can still run migrations or if legacy data is still needed.

### Evidence
- `008_auth0_member_profile.sql` drops table `users`.

### Exact file paths
- `netlify/functions/migrations/008_auth0_member_profile.sql`
- `docs/DB_BACKUP.md` or README section on backups

### Fix plan (exact approach)
1. Require documented backup/export before destructive migration.
2. Consider renaming the table to `users_legacy` first.
3. Ensure destructive steps are gated to production-only migration flows.

### Commands to validate
- Migration dry-run against a staging DB.

### Acceptance criteria
- Destructive schema changes are never triggered by preview traffic.
- A backup procedure is documented and required.

---

## F-009 — Resolve PartyKit / Fireproof mismatch (dead code vs missing dependency)
- **Severity:** Medium  
- **Scope:** Repo-wide

### Context
PartyKit appears configured but dependency resolution is incomplete.

### Evidence
- `src/partykit/server.ts` imports `@fireproof/partykit/server`.
- `partykit.json` expects a node_modules path.
- `@fireproof/partykit` is not in `package.json`.

### Exact file paths
- `src/partykit/server.ts`
- `partykit.json`
- `js/importmap.json`
- `package.json`

### Fix plan (exact approach)
Choose one path explicitly:
1. If unused: remove PartyKit files + config + importmap entries.
2. If required: add dependency and ensure the commands work in CI.

### Commands to validate
- If removed: `rg -n "partykit|fireproof"` shows only intentional references.
- If kept: `npm run partykit:dev` works in a suitable environment.

### Acceptance criteria
- PartyKit is either fully supported or fully removed — no half-state.

---

## F-010 — Restore bundle-size gate to green (CSS over limit)
- **Severity:** Medium  
- **Scope:** Repo-wide / performance gate

### Context
Size-limit currently fails due to CSS exceeding the configured gzipped size budget.

### Evidence
- `npm run perf:bundle` fails with `styles` at 10.37 kB gzipped vs 10 kB limit.

### Exact file paths
- `style.css`
- `package.json` (`size-limit` section)

### Fix plan (exact approach)
1. Identify the top CSS contributors.
2. Remove dead rules or reduce duplication.
3. If the limit is outdated, adjust it with justification and an updated baseline.

### Commands to validate
- `npm run perf:bundle`

### Acceptance criteria
- `npm run perf:bundle` passes.
- Any limit change is justified and documented.

---

## F-011 — Investigate dev vulnerability in `undici` and upgrade safely
- **Severity:** Low  
- **Scope:** Repo-wide / dependency hygiene

### Context
`npm audit` reports a moderate vulnerability in `undici` via the dev dependency graph.

### Evidence
- `npm audit` reports GHSA-g9mf-h72j-4rw9 affecting `undici`.

### Exact file paths
- `package-lock.json`
- transitive dependency chain (to be identified during fix)

### Fix plan (exact approach)
1. Identify which dependency pulls in the vulnerable `undici` version.
2. Upgrade the dependency chain to a patched version.
3. Avoid blind `npm audit fix` in production-sensitive contexts; upgrade deliberately.

### Commands to validate
- `npm audit`
- `npm test`
- `npm run build`

### Acceptance criteria
- `npm audit` returns 0 vulnerabilities, or a documented exception exists with rationale.

---

## F-012 — Add a build-time guard against placeholder Netlify context injection
- **Severity:** Medium  
- **Scope:** PR371 regression prevention

### Context
The production outage path began with placeholder context injection.

### Evidence
- PR #371 injected `${CONTEXT}` into the build environment.

### Exact file paths
- `tools/` (new guard script)
- `package.json` (`prebuild` script)

### Fix plan (exact approach)
1. Add a small guard script that fails when `VITE_NETLIFY_CONTEXT` contains `${` or `}`.
2. Run it during `prebuild`.

### Commands to validate
- `npm run build`
- Simulate bad env value and verify the guard fails loudly.

### Acceptance criteria
- Placeholder context values cannot be embedded silently into production builds.

---

# Next Codex Task Generator

A ready-to-run task specification has been generated here:

- `CODEX_TASK_FIX_BACKLOG_FROM_REVIEW.md`

It groups the backlog into safe, ordered batches and includes a Definition of Done per batch.

---

# Merge-readiness summary

## PR verdicts
- **PR #371:** NOT READY (production gating regression risk).
- **PR #372:** NOT READY (preview safety contract violation via migrations).
- **PR #373:** READY.
- **PR #374:** READY (but follow-ups recommended).

## Top blockers (must address first)
1. F-001 — preview contexts can run migrations.
2. F-002 — team members endpoint does not self-heal missing member rows.
3. F-004 — production host allowlist should be configuration-driven.
4. F-007 — preview deploys should fail-fast if pointed at production DB.
5. F-012 — add build-time guard against placeholder context injection.

---

# Compliance statement (business logic)

I did not modify any business-logic files or calculation outputs in this run. This work is review-only and documentation-only.
