# DB Backup (Cssmate / Delt sager)

Formålet er at sikre, at delte sager kan gendannes selv hvis hosting eller DB bliver nulstillet.

## Anbefalet rutine

- Kør eksport **ugentligt** eller mindst **månedligt**.
- Gem filerne et sikkert sted (fx Google Drive/OneDrive + evt. USB-drev).
- Del kun backup med betroede admins (filen indeholder sagsdata).

## Sådan laver du en backup

1. Log ind som admin.
2. Gå til Delt sager → Backup/Export (admin-funktion).
3. Download JSON-filen.
   - Filen får navn som `cssmate-backup-<team>-YYYY-MM-DD.json`.
4. (Valgfrit) Medtag soft-deleted sager ved at bruge `includeDeleted=1` i eksporten.

### Admin endpoint (JSON export)

- Endpoint: `GET /api/teams/{teamSlug}/backup`
- Returnerer en JSON-fil med alle delte sager for teamet.
- Brug `?includeDeleted=1` for at få soft-deleted sager med.

## Automatisk arkiv (Netlify Blobs, månedlig)

Hvis Netlify Blobs er aktiveret, kører en scheduled function månedligt og gemmer:

- Key-format: `backups/{teamSlug}/{YYYY-MM}.json.gz`
- Indhold: samme schema som admin-exporten (gzip-komprimeret JSON).

Anbefaling:

- Download månedlige arkiver til firmadrev/Drive.
- Gem min. én backup pr. måned i 5 år.

## Hvorfor dette er vigtigt

- Neon free-plan er ikke et 5-års arkiv.
- En manuel backup er den sikreste måde at bevare historik på.

## Gendannelse

- Importflowet for backup bruges til at indlæse sager igen.
- Hvis der mangler en automatiseret restore-proces, opret en drift-/supportopgave først.
