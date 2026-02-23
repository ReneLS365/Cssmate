# Delte sager — Prod checklist (Neon + Netlify)

## 1) Netlify env (Production)
- DATABASE_URL
- DATABASE_URL_UNPOOLED
- DATABASE_PROD_HOSTS (inkl. din prod Neon hostname)
- HEALTHCHECK_TOKEN (kun prod)
- MIGRATION_KEY (kun hvis du bruger migrate endpoint)
- ADMIN_PURGE_CODE (kun prod)
- VITE_AUTH0_DOMAIN / CLIENT_ID / AUDIENCE / REDIRECT_URI
- VITE_PROD_HOSTS = sscaff.netlify.app + evt custom domæner

## 2) Netlify env (Deploy Preview / Branch Deploy)
- Må IKKE have prod DB credentials
- DATABASE_PROD_HOSTS må gerne være sat (fail-fast guard)

## 3) Neon
- Kør migrations 001-011 mod prod DB (idempotent)
- Verificér /api/health/deep er grøn

## 4) Drift checks (skal være grøn)
- npm run verify:drift
- curl /api/health/deep (med token i prod hvis sat)
