# ENV notes (Netlify + Neon)

## Database URLs (production + preview)
- **Only** `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are used by functions.
- `NETLIFY_DATABASE_URL*` should be empty/unused to avoid accidental production wiring in preview.

## Database guardrails (preview safety)
- `DATABASE_PROD_HOSTS` (comma-separated hostnames) defines production DB hosts.
  - In non-production contexts, if `DATABASE_URL` resolves to a host in this list, functions fail fast.
  - Example: `DATABASE_PROD_HOSTS=main-prod.db.neon.tech,secondary-prod.db.neon.tech`
- Automatic migrations only run in production unless explicitly enabled.
  - Set `ALLOW_DB_MIGRATIONS=true` to allow auto-migrations in non-production (use with care).

## Preview safety contract
- Preview/branch deploys must **not** write to the DB.
- The API rejects write routes unless `CONTEXT=production`.

## Deploy context overrides (client)
- `VITE_PROD_HOSTS` (comma-separated hostnames) defines production hostnames on the client.
  - Used to force production gating even if `VITE_NETLIFY_CONTEXT` is misconfigured.
  - Example: `VITE_PROD_HOSTS=sscaff.netlify.app,app.example.com`
