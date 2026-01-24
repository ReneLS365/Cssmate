# CODEX TASK — Fix backlog from REVIEW_TODAY_PR_371_374.md

You are implementing the fixes identified in `REVIEW_TODAY_PR_371_374.md`.

## Mission
Stabilize deploy safety and Auth0 membership reliability **without changing calculation outputs**.

## Non-negotiable constraints
1. Do not change business-logic outputs (prices/calc/export/import/counting/scaffold).
2. No framework or bundler additions.
3. No half-fixes: each batch must be complete, tested, and shippable.
4. Do not commit generated publish artifacts.

---

# Safe ordering (must follow)

## Batch 1 — Deploy safety hardening (do this first)
Addresses: **F-001, F-007, F-008**

### Goals
- Prevent preview traffic from performing schema mutations.
- Fail fast if preview is pointed at a production database.
- Ensure destructive migrations cannot run implicitly via normal traffic.

### Required changes (explicit)
1. Gate automatic migrations in `netlify/functions/_db.mjs` so they only run in production (or behind an explicit env flag).
2. Add a context-aware database host guard:
   - in non-production contexts, detect production DB hosts and throw a safe, explicit error.
3. Update docs to explain the guardrails and migration policy.

### Definition of Done — Batch 1
- GET routes in deploy-preview do not run migrations.
- A preview environment pointed at a production DB fails fast and loudly.
- `npm test` and `npm run build` pass.

---

## Batch 2 — Membership reliability & write amplification
Addresses: **F-002, F-005, F-006**

### Goals
- Team page must self-heal missing member rows in production.
- Member registration should not spam writes.
- Read requests should not write to `teams` unnecessarily.

### Required changes (explicit)
1. In `handleTeamMembersList(...)`, upsert the calling user in production when missing.
2. Make `registerTeamMemberOnce(...)` actually “once per session” for the same key, with a clear override path.
3. Reduce write amplification in `ensureTeam(...)`:
   - prefer `ON CONFLICT DO NOTHING RETURNING` + fallback select.

### Definition of Done — Batch 2
- A user without a `team_members` row sees themselves after opening the Team page in production.
- Repeated session checks do not trigger repeated member upserts.
- Read traffic no longer writes to `teams` on every request.
- Tests cover all three behaviors.

---

## Batch 3 — Deploy-context regression prevention
Addresses: **F-003, F-004, F-012**

### Goals
- Production detection must be robust.
- Production hostnames must be configuration-driven.
- Placeholder env values must not silently break production.

### Required changes (explicit)
1. Add regression tests for production host override behavior.
2. Externalize production host allowlist via env var (e.g., `VITE_PROD_HOSTS`).
3. Add a prebuild guard that fails when placeholder values like `${CONTEXT}` are embedded.

### Definition of Done — Batch 3
- Deploy-context tests include production-host override scenarios and pass.
- Production hosts are configurable and documented.
- Builds fail fast when placeholder contexts are present.

---

## Batch 4 — Cleanup, performance gates, and dependency hygiene
Addresses: **F-009, F-010, F-011**

### Goals
- Resolve PartyKit half-state.
- Restore bundle-size gate to green.
- Remove or document the audit vulnerability.

### Required changes (explicit)
1. Decide and implement one clear outcome for PartyKit:
   - fully support it, or
   - fully remove it.
2. Make `npm run perf:bundle` pass by reducing CSS size or updating the budget with justification.
3. Address the `undici` vulnerability via targeted upgrades (no blind fixes).

### Definition of Done — Batch 4
- `rg -n "partykit|fireproof"` reflects a clean, intentional state.
- `npm run perf:bundle` passes.
- `npm audit` is clean or a documented exception exists.

---

# Required validation commands (run in each batch)

At minimum:
- `npm test`
- `npm run build`
- `npm run lint --if-present`
- Batch 4 additionally: `npm run perf:bundle` and `npm audit`

---

# Delivery format
1. Implement Batch 1 fully and stop.
2. Provide a short report:
   - files changed
   - why
   - commands run and outcomes
   - explicit statement that business-logic outputs were not changed
