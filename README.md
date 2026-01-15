# Cssmate (Sscaff)

Cssmate er en mobil-first, statisk PWA til stilladsmontører. Appen kører i ren HTML/CSS/Vanilla JS og er optimeret til hurtig brug på telefon.

## Quick start

```bash
npm install
npm run preview
npm run build
npm test
```

## Required env vars (backend)

Set these environment variables when running the Netlify functions locally or in production.
**Ingen dummy-fallbacks** som `base` må bruges i DB-konfigurationen.

- `DATABASE_URL` (primær, anbefalet). Til Neon: inkluder `sslmode=require`.
- Fallback: `NETLIFY_DATABASE_URL` eller `NETLIFY_DATABASE_URL_UNPOOLED`
- `AUTH0_DOMAIN` (fx `sscaff.eu.auth0.com`)
- `AUTH0_AUDIENCE` (Auth0 API identifier)
- `AUTH0_ISSUER` (fx `https://sscaff.eu.auth0.com`)
- `APP_ORIGIN` (fx `https://sscaff.netlify.app`)
- `BOOTSTRAP_ADMIN_EMAIL` (optional, default: `mr.lion1995@gmail.com`)
- `DEFAULT_TEAM_SLUG` (optional, default: `hulmose`)
- `EMAIL_PROVIDER_API_KEY` (Resend)
- `EMAIL_FROM` (fx `SSCaff <noreply@sscaff.dk>`)

**Netlify UI:** Site settings → Build & deploy → Environment → Environment variables.

## Auth0 (frontend)

Sæt følgende miljøvariabler til Auth0-login i klienten:

- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_AUDIENCE` (valgfri, kun hvis du kalder en API)
- `VITE_AUTH0_ORG_ID` (foretrukken) **eller** `VITE_AUTH0_ORG_SLUG` (fallback) – bruges til at tvinge korrekt organisation uden prompt
- `VITE_ADMIN_EMAIL` (legacy – én email der får admin-link)
- `VITE_ADMIN_EMAILS` (ny – kommasepareret liste til admin-rollen)

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
I Auth0-appen skal callback/logout-URLs inkludere:

- `http://127.0.0.1:4173`
- `http://127.0.0.1:4173/admin.html`
- `https://sscaff.netlify.app`
- `https://sscaff.netlify.app/admin.html`

**Allowed Web Origins** skal også inkludere `https://sscaff.netlify.app` (én s).

**Test lokalt:**

1. `npm run preview`
2. Åbn appen → klik **Log ind** → log ind via Auth0.
3. Bekræft at email vises og **Log ud** er synlig.
4. Hvis email matcher `VITE_ADMIN_EMAIL`, vises admin-linket.
5. Åbn `/admin.html` for at verificere admin-guard.

### Skip auth gate (CI/Lighthouse)

Til CI/Lighthouse kan login-gate springes over ved at tilføje query-parametret
`?skipAuthGate=1` (eller `?skipAuthGate=true`) til app-URL’en. Brug denne
parameter i testmiljøer fremfor miljøflags.

## Netlify production env vars

Følgende keys skal være sat i Netlify (production) for at auth, invites og DB virker korrekt:

- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_AUDIENCE` (optional)
- `VITE_AUTH0_ORG_ID` eller `VITE_AUTH0_ORG_SLUG`
- `VITE_ADMIN_EMAIL`
- `VITE_ADMIN_EMAILS`
- `AUTH0_DOMAIN`
- `AUTH0_AUDIENCE`
- `AUTH0_ISSUER`
- `NETLIFY_DATABASE_URL`
- `NETLIFY_DATABASE_URL_UNPOOLED`
- `BOOTSTRAP_ADMIN_EMAIL`
- `DEFAULT_TEAM_SLUG` (optional)
- `APP_ORIGIN`
- `EMAIL_PROVIDER_API_KEY`
- `EMAIL_FROM`

Bemærk: Ændringer til disse værdier kræver et fresh deploy, så `auth0-config.js` bliver regenereret via `npm run build:auth0-config`.

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

1. Hold ændringer isoleret til Historik/Team/Hjælp eller dokumenterede, sikre forbedringer.
2. Kør minimum:
   - `npm run build`
   - `npm test`
3. Manuel mobil-smoke (dokumenteres):
   - Sagsinfo, Optælling, Løn, Delt sager: uændret og fejlfrie.
   - Historik/Team/Hjælp: ændringer fungerer.
4. Bekræft “freeze compliance” i PR.

## Repo scan (lokal)

Kør repo-scan lokalt:

```bash
node tools/repo-scan.mjs
```

Output skrives til `reports/repo-scan/` og er gitignored (kun `.gitkeep` er tracked).
Opsummer fund og status i `docs/repo-scan-findings.md`. Del logs ved at zippe
`reports/repo-scan/` og vedhæfte til et GitHub-issue eller CI-artifact.
