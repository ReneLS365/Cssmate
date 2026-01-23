# ENV notes (Netlify + Neon)

## Database URLs (production + preview)
- **Only** `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are used by functions.
- `NETLIFY_DATABASE_URL*` should be empty/unused to avoid accidental production wiring in preview.

## Preview safety contract
- Preview/branch deploys must **not** write to the DB.
- The API rejects write routes unless `CONTEXT=production`.
