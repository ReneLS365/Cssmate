# Cleanup Rapport — Bundt 4

## Baseline & scans (lokalt i denne session)
- `npm install` (ok; EBADENGINE advarsel om Node v22 krav)
- `npm run lint --if-present` (ok)
- `npm test` (ok; Playwright tests skipped pga. manglende browser libs)
- `npm run build` (ok; build artifacts rullet tilbage efterfølgende)
- `rg -n "TODO|FIXME|DEPRECATED|HACK|TEMP" -S`
- `rg -n "old|legacy|deprecated|unused|dead" -S src netlify js`
- `node tools/repo-scan.mjs` (genererede `reports/repo-scan/*` lokalt; ikke committet)
- `npx depcheck` (se notater nedenfor)

## Fjernet/ryddet op (safe)
- **`js/shared-cases-panel.js`**: fjernet redundant kopi i `expandEntriesForDisplay` ved at droppe hjælpefunktionen og bruge direkte `caseItems` i render-flowet. Dette reducerer unødvendig array-allokering uden adfærdsændring.

## Depcheck (notater)
Depcheck rapporterede følgende som *mulige* issues, men de er sandsynligvis false positives pga. bundling/vendor filer eller runtime-brug:
- Unused deps: `@auth0/auth0-spa-js`
- Unused devDeps: `@size-limit/file`, `html-validate`, `jszip`, `terser`
- Missing deps (vendored): `playwright`, `@babel/runtime`, `fflate`, `html2canvas`, `dompurify`, `canvg`

**Handling:** Ingen dependencies fjernet i denne runde (risiko for regressions).

## Ikke fjernet
- `reports/repo-scan/**` artefakter er lokale og ikke committet jf. repo-policy.
- Vendor-filer med TODO-kommentarer blev ikke rørt.
