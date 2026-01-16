# Auth0 checklist (Cssmate / SSCaff)

## Auth0 Dashboard (Application settings)
Set these values on the Auth0 application that powers **sscaff.netlify.app**:

- **Allowed Callback URLs**
  - `https://sscaff.netlify.app/callback`
  - `http://localhost:5173/callback`
- **Allowed Logout URLs**
  - `https://sscaff.netlify.app`
  - `http://localhost:5173`
- **Allowed Web Origins**
  - `https://sscaff.netlify.app`
  - `http://localhost:5173`

> Tip: keep these URLs exact (no wildcards) to avoid Auth0 redirect errors.

## Auth0 Dashboard (Connections → “Use Auth0 dev keys” warning)
This warning is **not** fixable in frontend code. It must be handled in the Auth0 Dashboard:

1. Go to **Auth0 Dashboard → Authentication → Social** (or **Connections** for the relevant provider).
2. Open the provider connection (Google, Microsoft, etc.).
3. Disable **“Use Auth0 dev keys”**.
4. Paste your own **Client ID** + **Client Secret** from that provider.
5. Save the connection.
6. Reload the Auth0 warning page to confirm the warning disappears.

## Netlify / Local environment variables
Required (no secrets in repo):

- `VITE_AUTH0_DOMAIN` (e.g. `example.eu.auth0.com`)
- `VITE_AUTH0_CLIENT_ID` (Auth0 SPA client ID)
- `VITE_AUTH0_AUDIENCE` (Auth0 API identifier, optional but required if APIs expect it)
- `VITE_AUTH0_ORG_ID` / `VITE_AUTH0_ORGANIZATION_ID` (optional org ID to force)
- `VITE_AUTH0_ORG_SLUG` / `VITE_AUTH0_ORGANIZATION_SLUG` (optional org slug to force)
- `VITE_AUTH0_REDIRECT_URI` (optional; defaults to `${origin}/callback` when empty)
- `VITE_ADMIN_EMAIL` (admin bootstrap email if used)

If `VITE_AUTH0_DOMAIN` is empty the app will stop in the login overlay and emit a console error. If the domain does not match `*.auth0.com`, a warning is logged so you can verify tenant/custom domain configuration.

## Local test steps
1. `npm install`
2. Set env vars in your shell or `.env` (do **not** commit secrets).
3. Start a local server that matches the app:
   - `npm run preview`
4. Open `http://localhost:5173` in an incognito window.
5. You should be redirected to Auth0 within ~1s.
6. After login, you should return to the app (not stuck on `/callback`).

## Production test steps
1. Open `https://sscaff.netlify.app` in an incognito window.
2. Confirm immediate Auth0 redirect.
3. Log in and confirm you return to the app.
4. Log out and confirm you return to the app, then get prompted to log in again.
5. Hard refresh on `/callback` should not break the app.
