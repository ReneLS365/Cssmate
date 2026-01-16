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

## Auth env vars (frontend + backend)

Hold det kort – kun det relevante for login:

**Frontend (Vite):**
- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_AUDIENCE` (valgfri, anbefales hvis API er oprettet)
- `VITE_AUTH0_ORG_ID` **eller** `VITE_AUTH0_ORG_SLUG` (valgfri – kun hvis org skal tvinges)
- `VITE_AUTH0_REDIRECT_URI` (valgfri; hvis den kun er origin, tilføjes `/callback` automatisk)
- `VITE_APP_BASE_URL` (valgfri; default = `window.location.origin`)
- `VITE_ADMIN_EMAILS` (legacy fallback; **deprecated** når roles virker)

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
parameter i testmiljøer fremfor miljøflags.

## Netlify production env vars (auth only)

Sæt minimum disse auth-keys i Netlify (production):

- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_AUDIENCE` (optional)
- `VITE_AUTH0_ORG_ID` eller `VITE_AUTH0_ORG_SLUG` (optional)
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

## Database migrations

Kør migrations manuelt mod Neon/Postgres (idempotent):

```bash
psql "$DATABASE_URL" -f migrations/001_init.sql
psql "$DATABASE_URL" -f migrations/002_add_team_slug.sql
psql "$DATABASE_URL" -f migrations/003_auth0_invites.sql
```

## MIGRATION + DEPLOY CHECKLIST

1. Sæt env vars i Netlify (se ovenfor).
2. Verificér at `DATABASE_URL` (eller Netlify fallback) ikke er en dummy/placeholder.
3. Kør migrations i rækkefølge:
   - `migrations/001_init.sql`
   - `migrations/002_add_team_slug.sql`
   - `migrations/003_auth0_invites.sql`
4. Deploy og verificér:
   - Signup/login fungerer.
   - Team access og bootstrap-claim fungerer på default-teamet.
5. Ryd op i Netlify env vars: fjern evt. gamle, ubrugte auth-variabler.
6. Prerendering håndteres via Netlify Prerender‑udvidelsen (se `docs/PRERENDERING.md`).

## Guardrails (kort)

**Frosne faner:** Sagsinfo, Optælling, Løn, Delt sager.  
**Never change:** priser/datasæt, beregningslogik, materialeliste-logik/layout, eksport/offline-semantik og global/shared CSS der kan påvirke de frosne faner.

## Contribution flow + verification

1. **Auth-only**: Hold ændringer strengt til Auth0-login/adgangsstyring og dokumentation.
2. Kør minimum:
   - `npm run build`
   - `npm test`
3. Manuel mobil-smoke (dokumenteres):
   - Sagsinfo, Optælling, Løn, Delt sager: uændret og fejlfrie.
   - Auth0 login, redirect og admin-roller/permissions fungerer.
4. Bekræft “freeze compliance” i PR.

## Repo scan (lokal)

Kør repo-scan lokalt:

```bash
node tools/repo-scan.mjs
```

Output skrives til `reports/repo-scan/` og er gitignored (kun `.gitkeep` er tracked).
Opsummer fund og status i `docs/repo-scan-findings.md`. Del logs ved at zippe
`reports/repo-scan/` og vedhæfte til et GitHub-issue eller CI-artifact.
