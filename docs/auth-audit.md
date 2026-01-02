# Auth + Team Access Audit

## Entry points
- **Bootstrap/UI**
  - `main.js` → `app-main.js` → `src/auth/bootstrap.js`
  - Auth UI gate: `src/auth/auth-gate.js`
  - Auth provider glue: `src/auth/auth-provider.js`
- **Auth + config**
  - Firebase config helpers: `src/firebase/firebase-config.js`
  - Auth initialization + providers + App Check: `js/shared-auth.js`
  - Firestore wrapper + error tracking: `js/shared-firestore.js`
- **Session + access**
  - Session state machine: `src/auth/session.js`
  - Access mapping helpers: `src/auth/access-state.js`
  - Team access resolver: `src/services/team-access.js`
  - Team/member utilities + invites: `src/services/teams.js`
- **UI surfaces**
  - Team access guard: `src/ui/app-guard.js`
  - Team admin page + diagnostics: `src/ui/team-admin-page.js`
  - Debug overlay: `src/ui/debug-overlay.js`
- **Build-time config**
  - Public env generation (non-secret flags): `scripts/generate-firebase-config.js`

## Data flow (happy path)
1. **Config**: `js/shared-auth.js` reads Firebase config from `import.meta.env` via `src/firebase/firebase-config.js`.
2. **Validation**: `src/config/firebase-utils.js` validates required keys and rejects placeholders.
3. **Auth init**: Firebase Auth is initialized, persistence is set, and `getRedirectResult()` runs once.
4. **App Check**: Deferred init (idle) in `js/shared-auth.js` if enabled and a site key exists.
5. **Session**: `src/auth/session.js` listens to auth changes and resolves team access via `src/services/team-access.js`.
6. **Team access**: `teams/{teamId}/members/{uid}` and `teams/{teamId}` are fetched to determine role/status.
7. **UI**: `src/ui/app-guard.js` and `src/ui/team-admin-page.js` render the access/diagnostic states.

## Environment variables used
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_STORAGE_BUCKET` (optional)
- `VITE_FIREBASE_MESSAGING_SENDER_ID` (optional)
- `VITE_FIREBASE_MEASUREMENT_ID` (optional)
- `VITE_FIREBASE_RECAPTCHA_V3_SITE_KEY`
- `VITE_APP_CHECK_ENABLED`
- `VITE_FIREBASE_AUTH_PROVIDERS`
- `VITE_ADMIN_EMAILS`
- `VITE_E2E_TEST_MODE` (CI/local only; guarded)

## Firestore collections/paths
- `users/{uid}` (per-user cache/metadata)
- `teams/{teamId}`
- `teams/{teamId}/members/{uid}` ✅ canonical membership path (UID lock)
- `teams/{teamId}/cases/{caseId}`
- `teams/{teamId}/audit/{auditId}`
- `teams/{teamId}/backups/{backupId}`
- `teamInvites/{inviteId}` (team-level invites)

## Admin/team checks
- Access resolution: `src/services/team-access.js`
- Admin guard: `src/auth/admin.js` (`assertAdmin`, `isAdminSession`)
- UI enforcement: `src/ui/team-admin-page.js` and `src/ui/app-guard.js`

## App Check behavior
- Client init: `js/shared-auth.js` (`ensureAppCheck`)
  - Enabled via `VITE_APP_CHECK_ENABLED`
  - Requires `VITE_FIREBASE_RECAPTCHA_V3_SITE_KEY`
  - If missing, App Check is disabled and an **admin-only** warning is shown in Team → Admin diagnostic panel.
- Console settings must match:
  - App Check enforcement for Web app (if enabled)
  - reCAPTCHA v3 site key registered for the same Firebase project
  - Authorized domains include the app domain(s)

## Manual verification checklist (status)
These checks require a real Firebase environment and were **not run in this environment**:
- Sign-in/out: Not run (requires Firebase env)
- New user: Not run (requires Firebase env)
- Existing user: Not run (requires Firebase env)
- Admin user: Not run (requires Firebase env)
- Invite accept: Not run (requires Firebase env)
- Offline mode behavior: Not run (requires Firebase env)
