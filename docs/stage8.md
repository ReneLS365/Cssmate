# Stage 8 / Endelig QA

Denne fase samler QA-arbejdet efter Stage 1-7 og fokuserer på eksporternes korrekthed, performance og fuld testdækning. Brug checklisten som færdiggørelseskriterier for en release.

## Mål
- Valider PDF, ZIP og JSON-eksporter mod data i UI, inklusive round-trip import af JSON.
- Lighthouse CI (treosh/lighthouse-ci-action) skal opnå `categories.performance ≥ 0.95`.
- Alle build- og test-skripter skal køre uden fejl.
- Manuel røgtest af hele brugerflowet: Sagsinfo → Optælling → Løn → Eksport → Historik.
- Ingen ændringer i priser, satser eller beregningslogik; kun fejlrettelser, test- og performanceforbedringer.

## Checkliste

### 1. Eksportvalidering
1. Udfyld en fuld sag (Sagsinfo, Optælling, Løn, Ekstraarbejde) så alle sektioner har data.
2. Eksportér PDF, ZIP og JSON.
3. PDF: Åbn filen og sammenlign sagsinfo, totalsummer og materialer med UI. Ret PDF-genereringen ved uoverensstemmelser.
4. ZIP: Pak ud og bekræft, at PDF og JSON (og evt. Excel) svarer til UI-data.
5. JSON: Gem, reload appen, importér JSON, og bekræft at alle felter gendannes korrekt. Ret importlogik ved fejl.
6. Udvid automatiske tests til round-trip og filindhold, hvis muligt.

### 2. Lighthouse (min. 0.95)
1. Kør Lighthouse lokalt med `.lighthouserc.json`-config og sigt efter `categories.performance ≥ 0.95`.
2. Bekræft, at treosh/lighthouse-ci-action passerer i CI. Undersøg og optimér (uden logikændringer) hvis scoren svinger under målet.

### 3. Build og tests
1. Kør `npm ci`, `npm run build` og alle relevante `npm run test:*`-scripts (fx HTML/links/Lighthouse/SuperTest) samt `npm test`. Inkludér `npm run test:export` for at validere JSON/PDF/ZIP automatisk.
2. Fiks alle fejl og advarsler. CI-workflows (inkl. nightly og Lighthouse-job) skal være grønne.

### 4. Manuel fuld flow-test
1. Indtast realistiske data i Sagsinfo.
2. Optæl materialer og gennemfør løn/ekstraarbejde.
3. Eksportér PDF, ZIP og JSON, importér JSON igen og tjek Historik for korrekt visning og indlæsning uden dubletter.
4. Hold øje med konsolfejl og UI-afvigelser undervejs.

### 5. Ekstra npm-checks
- Kør `npm run format-check` og `npm run lint` (hvis tilgængelige) for at sikre style/lint-hygiejne.
- `npm run build` må ikke udløse warnings. Håndtér sikre warnings hvis de dukker op.
- `npm run test:export` skal være grøn (JSON/PDF/ZIP valideres mod testdata).

## PR-krav
- PR skal kort opsummere eksport-/import-validering, Lighthouse-resultater (≥ 0.95), teststatus og resultat af den manuelle fuld flow-test. Inkludér status for `npm run test:export` og performance-gaten (performance ≥ 0.95).
- Ingen logikændringer af priser eller satser i Stage 8; fokus er på robusthed, tests og performance.
