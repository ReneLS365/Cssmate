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
- `JWT_SECRET`
- `APP_BASE_URL` (fx `https://sscaff.netlify.app`)
- `BOOTSTRAP_ADMIN_EMAIL` (optional, default: `mr.lion1995@gmail.com`)
- `DEFAULT_TEAM_SLUG` (optional, default: `hulmose`)

**Netlify UI:** Site settings → Build & deploy → Environment → Environment variables.

## Database migrations

Kør migrations manuelt mod Neon/Postgres (idempotent):

```bash
psql "$DATABASE_URL" -f migrations/001_init.sql
psql "$DATABASE_URL" -f migrations/002_add_team_slug.sql
```

## MIGRATION + DEPLOY CHECKLIST

1. Sæt env vars i Netlify (se ovenfor).
2. Verificér at `DATABASE_URL` (eller Netlify fallback) ikke er en dummy/placeholder.
3. Kør migrations i rækkefølge:
   - `migrations/001_init.sql`
   - `migrations/002_add_team_slug.sql`
4. Deploy og verificér:
   - Signup/login fungerer.
   - Team access og bootstrap-claim fungerer på default-teamet.
5. Ryd op i Netlify env vars: fjern evt. gamle `VITE_FIREBASE_*` værdier.

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
