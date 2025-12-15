# Changelog

## v2025.13.0 – Kommentar til eksport og oprydning
- Fjernet Excel 25-ark eksport og tilhørende afhængigheder/UI.
- Tilføjet kommentarfelt til eksportpanelet og inkluderet kommentaren i JSON/PDF.
- Opdateret service worker, tests og styles efter fjernelse af Excel-funktionerne.

## v2025.12.10 – Export/Import Stabilisering
- Rettet: Manglende felter i PDF/JSON ved flere systemer og kombinerede lister.
- Forbedret: Fejlbeskeder og error-handling ved ugyldig import.
- Renset: Fjernet ubrugte imports, rettet lint-fejl, opdateret dokumentation.
- Optimeret: Reduceret filstørrelser, forbedret performance og fjernet unødvendige afhængigheder.
- Sikret: Round-trip-integritet for JSON.
