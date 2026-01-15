# Auth0 auto-login (force redirect)

Appen kræver login. Hvis brugeren ikke allerede er autentificeret, redirectes der automatisk til Auth0-login ved første load.

## Test links

- `/app-main.js` skal vise JS.
- `/auth0-config.js` skal vise config-værdier.

## Debug

Hvis du sidder fast eller vil trigge en ny auto-login:

- Ryd site data/cookies for domænet, eller
- Åbn i inkognito.

## UI locks efter callback

Når Auth0 redirecter tilbage til `/callback`, rydder `forceLoginOnce()` nu eventuelle auth overlays og UI-locks, så faner kan klikkes igen. Auth-gate rydder også `auth-locked`, `data-locked`, `auth-overlay-open` og `inert` ved succesfuld autentificering. Disse hard clears sikrer, at UI ikke bliver låst efter login.
