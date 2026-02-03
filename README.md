# Cssmate (Sscaff)

Cssmate er en mobil-first, statisk PWA til stilladsmontører. Appen kører i ren HTML/CSS/Vanilla JS og er optimeret til hurtig brug på telefon.

**Scope (AUTH-only):** Fremover er **kun** Auth0-login + adgangsstyring tilladt. Ingen andre ændringer, refactors eller UX-justeringer. Appen skal fungere uændret efter login.

## Quick start

```bash
npm install
npm run preview
npm run build
npm test
```

## Auth0 setup checklist (Tenant → Application → API → Organizations → Roles)

1. **Application (SPA)**: Type = SPA. Grant Types: Authorization Code (+ Refresh Token hvis nødvendigt).
2. **API (Resource Server)**: Stabil Identifier (fx `https://api.sscaff.app`), RBAC = ON, “Add Permissions in the Access Token” = ON.
3. **Roles/Permissions**:
   - `sscaff_admin` → `admin:app`, `admin:all`, `read:all`, `write:app`, `read:jobs`, `write:jobs`, `read:profile`
   - `sscaff_member` → `read:app`, `read:jobs`, `read:profile`
4. **Organizations**: Opret org (fx `hulmose`), invitér medlemmer, tildel roller (tenant roles).
5. **Token claims (Action)**: Tilføj namespaced claims i **ID + Access Token**:
   - `https://sscaff.app/roles`
   - `https://sscaff.app/org_id`
   - `https://sscaff.app/org_name`

### Auth0 application URLs

**Allowed Callback URLs:**
- `https://sscaff.netlify.app/callback`
- `http://localhost:5173/callback`

**Allowed Logout URLs:**
- `https://sscaff.netlify.app`
- `http://localhost:5173`

**Allowed Web Origins:**
- `https://sscaff.netlify.app`
- `http://localhost:5173`

### Invite links (organization + invitation)

Invite links understøtter Auth0-parametre:

- `organization=org_...`
- `invitation=inv_...`
- `returnTo=/sti` (valgfri, kun relative paths)

Disse forwardes til Auth0 login, så accept-flowet kan gennemføres uden hardcoded org.

## Auth env vars (frontend + backend)

Hold det kort – kun det relevante for login:

**Frontend (Vite):**
- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_AUDIENCE` (valgfri, anbefales hvis API er oprettet)
- `VITE_AUTH0_ORG_ID` (alias: `VITE_AUTH0_ORGANIZATION_ID`) **eller** `VITE_AUTH0_ORG_SLUG` (alias: `VITE_AUTH0_ORGANIZATION_SLUG`) (valgfri – kun hvis org skal tvinges)
- `VITE_AUTH0_REDIRECT_URI` (valgfri; hvis den kun er origin, tilføjes `/callback` automatisk)
- `VITE_APP_BASE_URL` (valgfri; default = `window.location.origin`)
- `VITE_ADMIN_EMAILS` (legacy fallback; **deprecated** når roles virker)

Hvis `VITE_AUTH0_DOMAIN` mangler, stopper appen i login-overlay og logger en tydelig fejl i konsollen. Hvis domænet ikke matcher `*.auth0.com`, logges en advarsel så tenant/custom domain kan verificeres.

**Backend (Netlify Functions / API):**
- `AUTH0_DOMAIN`
- `AUTH0_AUDIENCE`
- `AUTH0_ISSUER`
- `APP_ORIGIN`

## Auth debug overlay (mobil)

Aktivér overlay uden DevTools:

- Tilføj `?debug=1` til URL’en, **eller**
- Sæt `VITE_DEBUG_AUTH=1` (fx via `window.VITE_DEBUG_AUTH = '1'` før appen loader).

Overlayet viser auth/team-state, UI-låse og sidste hit-test. Brug **Copy debug** til at kopiere en JSON-dump. Det er især nyttigt hvis UI virker “død” efter login.

## Repro af “UI låst efter login”

1. Log ind via Auth0 som normalt.
2. Hvis tabs ikke reagerer, åbnes samme URL med `?debug=1` for at se auth- og hit-test status.
3. Brug **Copy debug** og del dumpen i fejlopfølgning.

## E2E regression (tabs klikbare efter auth)

Kør Playwright-testen der sikrer klikbare tabs i authenticated state:

```bash
VITE_E2E_BYPASS_AUTH=1 npm run test:e2e -- tests/e2e/admin-tabs-unlocked.spec.ts
```

## E2E — Delte sager (lokalt)

Kør Playwright-regressionerne for Delte sager:

```bash
VITE_E2E_BYPASS_AUTH=1 E2E_BASE_URL=http://127.0.0.1:4173 npm run test:e2e -- tests/e2e/shared-cases.spec.ts
```

Hvis du allerede har en preview-server kørende, så undgå at starte en ekstra server:

```bash
PLAYWRIGHT_SKIP_WEBSERVER=1 VITE_E2E_BYPASS_AUTH=1 E2E_BASE_URL=http://127.0.0.1:4173 npm run test:e2e -- tests/e2e/shared-cases.spec.ts
```

Lokalt: opret en `.env` i repo-roden med ovenstående værdier og kør `npm run preview`.
Universal Login kører via redirect-flow, så **ingen client secret må bruges i frontend**.
I Auth0-appen skal callback/logout-URLs matche checklisten øverst:

- `http://localhost:5173/callback`
- `https://sscaff.netlify.app/callback`
- Logout/Web Origins skal være `http://localhost:5173` og `https://sscaff.netlify.app`.

**Test lokalt:**

1. `npm run preview`
2. Åbn appen → klik **Log ind** → log ind via Auth0.
3. Bekræft at email vises og **Log ud** er synlig.
4. Hvis brugeren har admin-permission/rolle, vises admin-linket.
5. Åbn `/admin.html` for at verificere admin-guard.

### Skip auth gate (CI/Lighthouse)

Til CI/Lighthouse kan login-gate springes over ved at tilføje query-parametret
`?skipAuthGate=1` (eller `?skipAuthGate=true`) til app-URL’en. Brug denne
parameter i testmiljøer fremfor miljøflags. I production builds ignoreres
`skipAuthGate` uanset query-parametre.

## Netlify production env vars (auth only)

Sæt minimum disse auth-keys i Netlify (production):

- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_AUDIENCE` (optional)
- `VITE_AUTH0_ORG_ID`/`VITE_AUTH0_ORGANIZATION_ID` eller `VITE_AUTH0_ORG_SLUG`/`VITE_AUTH0_ORGANIZATION_SLUG` (optional)
- `VITE_AUTH0_REDIRECT_URI` (optional)
- `VITE_APP_BASE_URL` (optional)
- `VITE_ADMIN_EMAILS` (legacy fallback)
- `AUTH0_DOMAIN`
- `AUTH0_AUDIENCE`
- `AUTH0_ISSUER`
- `APP_ORIGIN`

Bemærk: Ændringer til disse værdier kræver et fresh deploy, så `auth0-config.js` bliver regenereret via `npm run build:auth0-config`.

## Netlify build notes

- Lighthouse audits er sat til `/index.html` for at undgå 404 efter root-redirect til `/admin.html`.
- Netlify Functions undgår `import.meta` så bundling til CJS ikke advarer.
- `MaxListenersExceededWarning` og `wasm streaming compile failed` fra Netlify tooling/redirector er kendt build-noise og påvirker ikke runtime.

## Observability

**/api/health (public):**
- Returnerer altid `200` hvis funktionen svarer.
- Indeholder drift-warnings (fx manglende env vars), men crasher ikke selv hvis noget mangler.

**/api/health/deep (token-beskyttet i production):**
- Kræver `HEALTHCHECK_TOKEN` i production og header `x-healthcheck-token`.
- I non-prod er token kun nødvendig hvis du selv har sat `HEALTHCHECK_TOKEN`.
- Udfører DB checks uden migrations og svarer med `ok` baseret på DB-tilstanden.

**X-Request-Id:**
- Alle API-responses inkluderer `X-Request-Id`.
- Du kan sende `x-request-id` på requesten for at korrelere logs.

**Netlify env import (UI):**
- Vælg **Skip conflicts** når du kun vil tilføje manglende keys.
- Vælg **Update conflicts** når du bevidst vil overskrive eksisterende værdier.

**Eksempler (relative paths):**
```bash
curl -i /api/health
curl -i /api/health/deep
curl -i -H "x-healthcheck-token: $HEALTHCHECK_TOKEN" /api/health/deep
```

**Production token (Netlify):**
- Sæt `HEALTHCHECK_TOKEN` kun i Production context for at beskytte `/api/health/deep`.

## DB setup (Neon) + migrations

Sørg for at Netlify Functions har adgang til databasen via env var:

- `DATABASE_URL` (primær)
- `DATABASE_URL_UNPOOLED` (direkte/uden pool)

Kør migrations manuelt mod Neon/Postgres (idempotent):

```bash
psql "$DATABASE_URL" -f netlify/functions/migrations/001_init.sql
psql "$DATABASE_URL" -f netlify/functions/migrations/002_add_team_slug.sql
psql "$DATABASE_URL" -f netlify/functions/migrations/003_auth0_invites.sql
psql "$DATABASE_URL" -f netlify/functions/migrations/004_add_team_member_login.sql
psql "$DATABASE_URL" -f netlify/functions/migrations/005_cases_indexes.sql
psql "$DATABASE_URL" -f netlify/functions/migrations/006_cases_defaults.sql
psql "$DATABASE_URL" -f netlify/functions/migrations/007_cases_workflow.sql
psql "$DATABASE_URL" -f netlify/functions/migrations/008_auth0_member_profile.sql
psql "$DATABASE_URL" -f netlify/functions/migrations/009_cases_attachments.sql
psql "$DATABASE_URL" -f netlify/functions/migrations/010_cases_legacy_columns.sql
psql "$DATABASE_URL" -f netlify/functions/migrations/011_cases_workflow_v2.sql
```

Valgfri: kør migrations via Netlify Function (one-off):

```bash
curl -X POST "https://<din-site>/.netlify/functions/migrate" \
  -H "x-migration-key: $MIGRATION_KEY"
```

Kræver env var i Netlify:

- `MIGRATION_KEY` (kun til migrations-endpointet)

## MIGRATION + DEPLOY CHECKLIST

1. Sæt env vars i Netlify (se ovenfor).
2. Verificér at `DATABASE_URL`/`DATABASE_URL_UNPOOLED` ikke er en dummy/placeholder.
3. Kør migrations i rækkefølge:
   - `netlify/functions/migrations/001_init.sql`
   - `netlify/functions/migrations/002_add_team_slug.sql`
   - `netlify/functions/migrations/003_auth0_invites.sql`
   - `netlify/functions/migrations/004_add_team_member_login.sql`
   - `netlify/functions/migrations/005_cases_indexes.sql`
   - `netlify/functions/migrations/006_cases_defaults.sql`
   - `netlify/functions/migrations/007_cases_workflow.sql`
   - `netlify/functions/migrations/008_auth0_member_profile.sql`
   - `netlify/functions/migrations/009_cases_attachments.sql`
   - `netlify/functions/migrations/010_cases_legacy_columns.sql`
   - `netlify/functions/migrations/011_cases_workflow_v2.sql`
4. Deploy og verificér:
   - Auth0 login fungerer.
   - Team access og medlemsregistrering fungerer på default-teamet.
5. Ryd op i Netlify env vars: fjern evt. gamle, ubrugte auth-variabler.
6. Prerendering håndteres via Netlify Prerender‑udvidelsen (se `docs/PRERENDERING.md`).

## Guardrails (kort)

**Tilladt UI/navigation/gating:** `src/auth/**`, `src/ui/**`, `src/app/**`, `src/pages/**`, `src/state/**`, `js/shared-auth.js`.  
**Never change:** priser/datasæt, beregningslogik, materialeliste-logik/layout, eksport/offline-semantik og global/shared CSS der kan påvirke beregnings- og dataflow.

## Delt sager workflow (kort)

- Status-flow: `kladde → godkendt → demontage_i_gang → afsluttet` (soft delete = `deleted`).
- `phase` angiver montage/demontage (bruges til import og PDF).
- Afsluttede sager grupperes pr. sagsnr/jobnr og viser seneste montage + demontage med versionhistorik.
- Statusopdateringer bruger `ifMatchUpdatedAt` for robust samtidighed mellem brugere.

## Shared cases API (kort)

- `GET /api/teams/:team/cases` → `{ data, cursor, hasMore, total }`
- `GET /api/teams/:team/cases?since=...&sinceId=...` → `{ data, deleted, cursor }`
- `POST /api/teams/:team/cases` → opret/opfdater via `job_number`
- `PATCH /api/teams/:team/cases/:id/status` → statusændring m. `ifMatchUpdatedAt`
- `POST /api/teams/:team/cases/:id/approve` → godkend montage/demontage
- `DELETE /api/teams/:team/cases/:id` → soft delete (admin/owner)
- `POST /api/admin/teams/:team/purge` → permanent sletning af soft-deleted (admin/owner)

## Contribution flow + verification

1. Hold ændringer til UI/navigation/gating og dokumentation.
2. Kør minimum:
   - `npm run build`
   - `npm test`
3. Manuel mobil-smoke (dokumenteres):
   - Sagsinfo, Optælling, Løn, Delt sager: fejlfrie og beregninger uændrede.
   - Auth0 login, redirect og admin-roller/permissions fungerer.
4. Bekræft “business-logic compliance” i PR.

## Repo scan (lokal)

Kør repo-scan lokalt:

```bash
node tools/repo-scan.mjs
```

Output skrives til `reports/repo-scan/` og er gitignored (kun `.gitkeep` er tracked).
Opsummer fund og status i `docs/repo-scan-findings.md`. Del logs ved at zippe
`reports/repo-scan/` og vedhæfte til et GitHub-issue eller CI-artifact.
