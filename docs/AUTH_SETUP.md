# Firebase Auth setup (sscaff)

## Authorized domains
Firebase Auth → **Authorized domains** must include:
- `sscaff.netlify.app`
- Optional for local dev: `localhost`

If deploy previews are used, add the specific Netlify preview domain(s) you rely on.

## Notes
- Login config is served at runtime via `/.netlify/functions/firebase-config`.
- Netlify environment variables remain the single source of truth.
