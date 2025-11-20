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
- `npm run test:super` – kombineret testflow der kører build + samtlige audits.
- `npm run release:guard` – samlekommando til PR/merge, kører hele test:super-flowet og validerer at Lighthouse-rapporten scorer 1.0 i alle kategorier.

Pull requests må kun merges når `npm run release:guard` er grøn (kører automatisk i GitHub Actions på push/PR til `main`).

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
