# Release artifacts v2025.12.10

Artefakterne genereres nu automatisk af Playwright E2E-tests.

## Mapper
- `basic/` – `basic.pdf`, `basic.json` samt `basic-roundtrip.json` fra basis-scenariet.
- `multi/` – `multi.pdf`, `multi.json` for flere systemer.
- `combined/` – `combined.pdf`, `combined.json` for kombinerede lister/jobtyper.
- `edge/` – reserveret til evt. edge-case-eksporter (fx edge_small/edge_large).

Kør `npm run test:e2e` for at starte serveren lokalt, åbne Cssmate i headless browser og gemme exports i ovenstående mapper. Efter et run vil filerne ligge i `release-artifacts/v2025.12.10/` og kan uploades som release-artifacts.
