# Cssmate (Sscaff)

Cssmate er en mobil-first, statisk PWA til stilladsmontører. Appen kører i ren HTML/CSS/Vanilla JS og er optimeret til hurtig brug på telefon.

## Quick start

```bash
npm install
npm run preview
npm run build
npm test
```

## Guardrails (kort)

**Frosne faner:** Sagsinfo, Optælling, Løn, Delt sager.  
**Never change:** priser/datasæt, beregningslogik, materialeliste-logik/layout, eksport/offline-semantik og global/shared CSS der kan påvirke de frosne faner.

## Contribution flow + verification

1. Hold ændringer isoleret til Historik/Team/Hjælp eller dokumenterede, sikre forbedringer.
2. Kør minimum:
   - `npm run build`
   - `npm test`
3. Manuel mobil-smoke (dokumenteres):
   - Sagsinfo, Optælling, Løn, Delt sager: uændret og fejlfrie.
   - Historik/Team/Hjælp: ændringer fungerer.
4. Bekræft “freeze compliance” i PR.

## Repo scan (lokal)

Kør repo-scan lokalt med:

```bash
node tools/repo-scan.mjs
```

Kopiér de vigtigste fund til `docs/repo-scan/KNOWN_ISSUES.md`. Scan-rapporter under
`reports/repo-scan/` er lokale artefakter og må ikke commit’es. Hvis du har brug for at dele
logs, zip `reports/repo-scan/` og vedhæft som GitHub-issue eller CI-artifact.
