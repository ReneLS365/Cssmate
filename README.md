# CSMate – simple/mobile deploy snapshot

CSMate er en letvægtsudgave af den oprindelige Cssmate-applikation, målrettet statisk hosting og mobile enheder. Repoet indeholder hele den genererede app (HTML, CSS, JS, datafiler og service worker), hjælpeværktøjer til datasynkronisering samt dokumentation og byggeartefakter til Netlify.

## Arkitektur og mappeoversigt

| Mappe/fil | Beskrivelse |
| --- | --- |
| `app/` | Selve PWA'en: `index.html`, komponent CSS under `app/css`, scriptmoduler under `app/js` og en `service-worker.js`, der styrer caching af statiske assets og data snapshots. |
| `app/data/` | JSON- og CSV-kilder som bruges af build-scripts til at fylde appen med prislister og andre referenceoplysninger. |
| `app/cache-output.json` | Snapshot af hvilke assets SW'en skal pre-caches med. |
| `docs/lighthouse/` | Gemmer Lighthouse-målinger; `latest-mobile.json` overskrives ved nye audits. |
| `scripts/` | Node-scripts til f.eks. at bump'e SW-version (`bump-sw-version.js`) og opdatere prislister (`update-price-lists.js`). |
| `tools/` | Hjælpeværktøjer, fx `lh-enforce.js` til at gate builds på Lighthouse-scorer. |
| `netlify.toml` | Netlify build- og deploykonfiguration. |

## NPM-scripts

- `npm run bump-sw-version` – sørger for cache-busting ved at opdatere `CACHE_VERSION` og generere ny asset-liste til service worker.
- `npm run update-prices` – regenererer prislister baseret på datafilerne i `app/data/`.
- `npm run build` – alias for `bump-sw-version`, så Netlify kan bygge en frisk pakke før deploy.
- `npm run test:html` – validerer markup med `html-validate`.
- `npm run test:links` – crawler `app/` og sikrer at interne links virker.
- `npm run test:lh:mobile` – kører Lighthouse mod et givent URL (default `LHCI_URL`) med mobilprofil og deterministiske throttling-flags.
- `npm run test:lh:enforce` – læser `docs/lighthouse/latest-mobile.json` og fejler hvis scorerne falder.
- `npm run test:super` – kombineret testflow der kører build + samtlige audits.

## CODEx Autonomous CI Bootstrapper

For fuldautomatisk CI/CD (inkl. Lighthouse, SW-validering, SuperTest og Netlify deploy) leveres scriptet `codex-bootstrap.js` i roden.

1. Kør `node codex-bootstrap.js` for at generere:
   - Workflowen `.github/workflows/codex-master.yml`
   - Lighthouse-konfiguration (`.lighthouserc.json`) og score-checker (`ci/check-lh-score.js`)
   - Service-worker sanity check (`ci/check-sw.js`)
   - En SuperTest-baseret smoke-test (`tests/app-flow.test.js`)
2. Tilføj `NETLIFY_AUTH_TOKEN` og `NETLIFY_SITE_ID` som GitHub-secrets, så deploy-jobbet kan køre.
3. Commit alle genererede filer. Herefter vil Codex-SSCAFF styre lint/build/test/Lighthouse/version bump og Netlify deploy ved push og pull requests mod `main`.

## Udviklingsflow

1. Rediger indhold/komponenter i `app/` og datafiler i `app/data/` eller `app/src/`.
2. Kør relevante scripts (fx `npm run update-prices`) og test lokalt med `npm run test:super`.
3. Når du er klar til deploy, commit ændringer, kør bootstrap-scriptet hvis workflow-filer mangler, og push til GitHub. Netlify vil hente den byggede `dist/` fra workflowet og publicere automatisk.

Denne README giver dermed både en funktionsoversigt over appen og praktiske instruktioner til hvordan CI/CD holdes selvkørende.
