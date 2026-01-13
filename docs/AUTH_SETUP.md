# Auth setup (sscaff)

## Firebase (legacy)
### Authorized domains
Firebase Auth → **Authorized domains** must include:
- `sscaff.netlify.app`
- Optional for local dev: `localhost`

If deploy previews are used, add the specific Netlify preview domain(s) you rely on.

## Notes
- Login config is read from `import.meta.env` in the client.
- Netlify environment variables remain the single source of truth.

## Auth0 setup (SSCaff)
Auth0 is the canonical auth provider in SSCaff. Configuration is embedded in the build by running
`node scripts/generate-auth0-config.mjs`, which writes `auth0-config.js` with values from:
- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_AUDIENCE`
- `VITE_ADMIN_EMAIL`

The app loads these values from `window.__ENV__` on startup.

### Auth0 Application settings (production)
Auth0 Dashboard → Applications → **SSCaff**:
- **Allowed Callback URLs:**  
  `https://sscaff.netlify.app`  
  `https://sscaff.netlify.app/`  
  `https://sscaff.netlify.app/admin.html`  
  `https://sscaff.netlify.app/reset.html`
- **Allowed Logout URLs:**  
  `https://sscaff.netlify.app`  
  `https://sscaff.netlify.app/`
- **Allowed Web Origins** + **Allowed Origins (CORS):**  
  `https://sscaff.netlify.app`  
  `https://sscaff.netlify.app/`

Remove localhost entries from production apps. Add only the exact domains you intend to support.

## Auth gate behavior
Auth gate runs before the app bootstraps. The UI overlay is shown until the user is authenticated.
Query parameters like `?skipAuthGate=1` are ignored in production.

## Ryd service worker cache (Reparer app)
Når brugere sidder fast på en gammel version:
1. Åbn login overlayet.
2. Tryk **“Reparer app (ryd cache)”**.
3. Appen afregistrerer service workers og rydder cache storage før den genindlæser.
