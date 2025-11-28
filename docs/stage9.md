# Stage 9 – Automatisk QA

Denne fase automatiserer Stage 8-checklisten, så eksportfiler, Lighthouse-krav og tests køres som scripts/CI fremfor manuelt arbejde.

## Mål
- Automatisér validering af eksportfiler (PDF/ZIP/JSON) med scripts.
- Kør Lighthouse i CI med `categories.performance ≥ 0.95`.
- Kør build- og test-scripts (`npm ci`, `npm run build`, `npm test`, `npm run test:*`) som en del af CI og fail workflows ved fejl.
- Ingen ændringer i priser, satser eller beregningslogik; fokus er automatiseret QA.

## Opgaver

### 1. Eksportfil-tests
1. Tilføj en Node-baseret test (fx `tests/export-files.test.js`):
   - Brug eksisterende build/serve-helpers (`npm run build`, lokal server for `dist/`).
   - Generér eksport-filer via UI (headless browser) eller direkte eksport-helpers.
   - Gem PDF, ZIP og JSON i en temp-mappe.
2. Kontroller indholdet:
   - **JSON:** parse og verificer sagsinfo, optælling og løn mod et hardcoded testinput.
   - **ZIP:** åbn med `JSZip` (eller tilsvarende i eksisterende stack) og bekræft at PDF + JSON matcher.
   - **PDF:** udtræk tekst (fx `pdf-parse`/`pdfjs` eller nuværende tooling) og assert sagsnummer, kunde og kendte summer.
3. Round-trip: importér den genererede JSON og bekræft datakonsistens. Testen skal fejle ved uoverensstemmelser.

### 2. Lighthouse i CI
1. Tilføj/udvid CI-step med `treosh/lighthouse-ci-action` og `.lighthouserc.json`.
2. `assertions.categories.performance.minScore` skal være `0.95`; workflow skal fejle under denne score.

### 3. CI-workflow
1. I CI-pipelinen (fx `.github/workflows/ci.yml`):
   - `npm ci`
   - `npm run build`
   - `npm run lint --if-present` og `npm run format-check --if-present`
   - `npm test` samt `npm run test:export --if-present`
   - Lighthouse-step med konfig ovenfor
2. Brug artifacts til at gemme rapporter/logs (eksport-filer og Lighthouse-resultater) efter behov.
3. Sørg for at nightly-workflow også kører de nye tests.

### 4. GitHub Checks output (valgfrit)
- Formater eksport- og Lighthouse-resultater som check-annoteringer/outputs for hurtig fejlfinding i PR UI.

### 5. README/docs
- Notér at Stage 9 introducerer automatiske eksport-tests og Lighthouse-gating i CI, inkl. lokal kørsel via `npm run test:export`.

## PR-titel
`test: add automated export validation and integrate lighthouse into CI (stage 9)`

## PR-beskrivelse (skabelon)
```
## Formål
Automatisere Stage 8-checklisten: valider eksportfiler, kør Lighthouse ≥ 0,95, og kør alle tests som en del af CI.

## Hvad er gjort
- Tilføjet `tests/export-files.test.js` til automatiseret validering af PDF, ZIP og JSON (inkl. round-trip og ZIP-indhold).
- Udvidet CI-workflow til at:
  - installere, bygge og lint’e projektet
  - køre alle test-scripts, inkl. eksport-tests
  - køre Lighthouse via treosh/lighthouse-ci-action med minScore 0.95
- Opdateret README med instruktioner for lokale eksport-tests og automatiske checks.
- Ingen ændring i priser, satser eller beregningslogik.

## Tests
- [x] `npm ci`
- [x] `npm run build`
- [x] `npm run test` + nye eksport-tests
- [x] Lighthouse-job med performance ≥ 0.95
- [x] Manuelt verificeret, at eksport-filer genereres korrekt (sanity-check)
```
