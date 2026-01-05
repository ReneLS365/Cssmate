# Repo scan – kendte issues

Senest opdateret: 2026-01-05

## Nøglefund fra seneste repo-scan

- **Build:** Fejler pga. manglende/placeholder Firebase-miljøvariabler i scan-miljøet.
- **Bundle-størrelse:** `perf:bundle` rapporterer CSS-bundle over grænsen.
- **Lighthouse (mobil):** Fejler uden Chrome/Chromium i miljøet.
- **Tests:** `npm test` kørte og var grøn i scan-loggen.

## Action items

- Tilføj lokale/CI Firebase-miljøvariabler, så `npm run build` kan gennemføres i repo-scan.
- Undersøg CSS-bundle over grænsen og justér grænse eller reducer størrelsen på legitim vis.
- Kør Lighthouse i et miljø med Chrome/Chromium eller dokumentér hvorfor den er utilgængelig.

## Noter

- Opdatér denne fil efter hver lokal `node tools/repo-scan.mjs` kørsel.
- Scan-logs og rapporter er lokale artefakter og må ikke commit’es.
