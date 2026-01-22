# DB backup & eksport (Delt sager)

Formålet er at sikre en stabil, manuel backup-strategi for delte sager, så data kan genskabes uden at påvirke pris-/beregningslogik.

## Anbefalet cadence

- Tag backup **ugentligt eller månedligt**, afhængigt af hvor ofte teamet arbejder i Delt sager.
- Gem eksporten uden for Netlify (fx firmadrev, OneDrive, Google Drive).

## Backup via API (JSON)

1. Log ind som admin.
2. Kald backup endpointet for teamet:
   - `GET /api/teams/{teamSlug}/backup`
   - Inkludér slettede sager ved behov: `GET /api/teams/{teamSlug}/backup?includeDeleted=1`
3. Gem JSON-filen lokalt som langtidshistorik.

Eksporten er det langsigtede arkiv. Neon “history retention” er **ikke** en backup-strategi.

## Valgfrit: pg_dump

Hvis du har direkte adgang til databasen:

```bash
pg_dump "$DATABASE_URL_UNPOOLED" > sscaff-backup-$(date +%F).sql
```

Brug **unpooled** connection string for at undgå pooler-begrænsninger.

## Miljøer og sikkerhed

- **Production**: brug `DATABASE_URL` (pooled) og `DATABASE_URL_UNPOOLED` (direct).
- **Preview deploys** må **ikke** pege på production DB. Brug staging DB eller read-only credentials.
