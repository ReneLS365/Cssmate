# Firebase tjekliste (sscaff-43a33)

## Netlify miljøvariabler
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID` (brug `sscaff-43a33`)
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_STORAGE_BUCKET` (valgfri men anbefalet)
- `VITE_FIREBASE_MESSAGING_SENDER_ID` (valgfri)
- `VITE_FIREBASE_MEASUREMENT_ID` (valgfri)
- `VITE_FIREBASE_AUTH_PROVIDERS` (komma-separeret, fx `google,microsoft`)

`npm run build` genererer `js/firebase-env.js` med **ikke-hemmelige** indstillinger (providers, App Check m.m.). Selve Firebase-konfigurationen læses direkte fra `import.meta.env` i klienten.

## Firebase Auth – tilladte domæner
- `sscaff.netlify.app`
- `*.netlify.app` (deploy previews)
- `localhost` og `127.0.0.1` til lokale tests
- Evt. ekstra custom domæner, hvis de peger på samme frontend

## Firestore database
- Opret som **Native** Firestore i region **europe-west3 (Frankfurt)** for lav latenstid i DK/SE.
- Bekræft at projekt-id er `sscaff-43a33` før oprettelse.

## Deployment af regler
1) Kør `npm run test:rules` (kræver Firestore emulator) for at sikre at reglerne holder de nye krav.
2) Deploy med `npx firebase deploy --only firestore --project sscaff-43a33`.
3) Verificér i Firebase Console, at regelsættet matcher commit og at der ikke er ubrugte stager.
