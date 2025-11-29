# CSMate – simple/mobile deploy snapshot

CSMate er en letvægtsudgave af den oprindelige Cssmate-applikation, målrettet statisk hosting og mobile enheder. Repoet indeholder hele den genererede app (HTML, CSS, JS, datafiler og service worker), hjælpeværktøjer til datasynkronisering samt dokumentation og byggeartefakter til Netlify.

## Arkitektur og mappeoversigt

| Mappe/fil | Beskrivelse |
| --- | --- |
| `index.html` | Hoved-app'en med Optælling/akkord-flow. Loader CSS/JS direkte fra roden. |
| `css/`, `style.css`, `print.css` | Styles til runtime og print. |
| `js/` | Delte runtime-scripts (bl.a. numpad, version og eksport-helpers). |
| `src/` | Moduliseret forretningslogik og UI-helpers som importeres fra `main.js`. |
| `data/`, `dataset.js`, `complete_lists.json` | Materialedata og genererede prislister. |
| `icons/`, `manifest.webmanifest` | PWA-manifest og ikonfiler. |
| `akkord/` | Excel-skabeloner til eksport. |
| `legacy/` | Arkiveret kode der ikke længere indlæses (tidligere pctcalc/numpad-stubs m.m.). |
| `docs/lighthouse/` | Gemmer Lighthouse-målinger; `latest-mobile.json` overskrives ved nye audits. |
| `scripts/` | Node-scripts til f.eks. at bump'e SW-version (`bump-sw-version.js`) og opdatere prislister (`update-price-lists.js`). |
| `tools/` | Hjælpeværktøjer, fx `lh-enforce.js` til at gate builds på Lighthouse-scorer. |
| `netlify.toml` | Netlify build- og deploykonfiguration. |

## NPM-scripts

- `npm run bump:sw` – opdaterer `CACHE_VERSION` i service workeren med tidsstempel.
- `npm run bump-sw-version` – alias for bump-scriptet.
- `npm run update-prices` – regenererer prislister baseret på datafilerne i `data/`.
- `npm run build` – prefixer et SW-version-bump før øvrige buildsteps.
- `npm run test:html` – validerer markup med `html-validate`.
- `npm run test:links` – crawler projektroden og sikrer at interne links virker.
- `npm run test:lh:mobile` – kører Lighthouse mod et givent URL (default `LHCI_URL`) med mobilprofil og deterministiske throttling-flags.
- `npm run test:lh:enforce` – læser `docs/lighthouse/latest-mobile.json` og fejler hvis scorerne falder.
- `npm run test:export` – bygger, mocker eksport-flowet og validerer JSON/PDF/ZIP-indholdet.
- `npm run test:super` – kombineret testflow der kører build + samtlige audits.
- `npm run release:guard` – samlekommando til PR/merge, kører hele test:super-flowet og validerer at Lighthouse-rapporten scorer 1.0 i alle kategorier.
- `npm run dev:mat-debug` – starter en stille http-server på port 4174 for at inspicere debug-sider som `debug/material-row-debug.html`.

Åbn `http://localhost:4174/debug/material-row-debug.html` under udvikling for at se den rå markup fra optællingsfanens materialerække med identisk styling som appen bruger.

## CI & Codex

- Push og PR mod `main` kører automatisk GitHub Actions, som bygger, kører tests (`npm test` + `npm run test:export`) og laver et Lighthouse-check med tærskel 0,95 på alle kategorier (performance gate er eksplicit sat til ≥0,95).
- Nightly workflow kører dagligt kl. 03:00 UTC med `npm ci`, `npm run build`, export-test og hele testsuiten (inkl. app-flow smoken), så buildet forbliver sundt.
- Lokalt kan du spejle CI ved at køre:
  - `npm ci`
  - `npm run build`
  - `npm test`

Se også `docs/stage8.md` for den afsluttende QA-checkliste (eksport/round-trip, Lighthouse ≥ 0.95, fuld testpakke og manuel flow-smoke), som bør gennemføres før release. For fuld automatisering af QA-flowet, kør `npm ci && npm run build && npm test && npm run test:export` lokalt – samme flow som i CI, hvor performance-gaten fejler PR'en hvis scoren er under 0,95.

## Brugerflow (kort)

1. Udfyld **Sagsinfo** med nummer, navn, adresse, kunde, dato og montør.
2. Vælg system i **Optælling** og indtast materialer via numpad.
3. Gå til **Løn** for arbejdstype, timer, km og ekstraarbejde og tryk **Beregn løn**.
4. Eksportér fra **Resultat/Eksport** (PDF/JSON/ZIP), eller genindlæs sager via **Historik**.
5. Brug **Hjælp**-fanen for hurtige tips og fejlretning.

## Admin-mode

- Admin-kode udleveres af administrator og låser prisfelter og avancerede muligheder op til intern brug.
- Almindelige brugere bør blive i normal tilstand; admin-mode ændrer ikke beregningslogikken.

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

1. Rediger indhold/komponenter i roden (fx `index.html`, `css/`, `js/`, `src/`) og datafiler i `data/`.
2. Kør relevante scripts (fx `npm run update-prices`) og test lokalt med `npm run test:super`.
3. Når du er klar til deploy, commit ændringer, kør bootstrap-scriptet hvis workflow-filer mangler, og push til GitHub. Netlify vil bruge roden som publish-dir.

Denne README giver dermed både en funktionsoversigt over appen og praktiske instruktioner til hvordan CI/CD holdes selvkørende.
