# DB schema contract (Neon / Postgres)

Denne kontrakt sikrer, at `team_cases`-schema og tilhørende tabeller/indexes er fuldt migreret (001–011), før produktionstrafik rammer funktionerne.

## Forudsætninger

- `DATABASE_URL` peger på den rigtige Neon branch (typisk production).
- `psql` er installeret lokalt (krævet for migrations-runner).
- For schema-check kan du bruge enten:
  - `DATABASE_URL_UNPOOLED` (anbefalet)
  - fallback: `DATABASE_URL`

## Kør migrationer deterministisk

```bash
npm run db:migrate
```

Scriptet kører i fast rækkefølge:
1. `001_init.sql`
2. `002_add_team_slug.sql`
3. `003_auth0_invites.sql`
4. `004_add_team_member_login.sql`
5. `005_cases_indexes.sql`
6. `006_cases_defaults.sql`
7. `007_cases_workflow.sql`
8. `008_auth0_member_profile.sql`
9. `009_cases_attachments.sql`
10. `010_cases_legacy_columns.sql`
11. `011_cases_workflow_v2.sql`

Stopper ved første fejl (`ON_ERROR_STOP=1`).

## Verificér schema-kontrakt (read-only)

```bash
npm run db:verify
```

Checks:
- Tabeller: `teams`, `team_members`, `team_cases`, `team_audit`
- `team_cases` kolonner:
  - `attachments`
  - `phase`
  - `last_editor_sub`
  - `last_updated_at`
  - `status`
  - `totals`
- `team_cases` indexes:
  - `team_cases_team_created_idx`
  - `team_cases_team_updated_idx`
  - `team_cases_team_status_created_idx`
  - `team_cases_team_creator_status_idx`
  - `team_cases_team_updated_at_idx`

Exit code:
- `0`: schema matcher kontrakten.
- `1`: manglende elementer listes kort under `tables`, `columns`, `indexes`.

## Drift-signal i deep health

`/api/health/deep` rapporterer nu schema drift tydeligt:
- `status: "degraded"`
- `code: "DB_SCHEMA_DRIFT"`
- `missing: { tables: [], columns: [], indexes: [] }`

Det gør schema-mangler synlige uden at logge secrets.
