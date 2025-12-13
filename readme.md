# Cssmate / SSCaff

Mobil-first PWA til stilladsoptælling, akkordberegning og eksport/import (PDF + JSON).
Appen er i drift og deployed via Netlify.

## Status (vigtigt)
Projektet er **låst i struktur og funktionalitet**.

Fra og med nu gælder følgende:

- **ALLE eksisterende faner er FROSTET**
- **Ingen faner må ændres, refaktoreres, flyttes eller udvides**
- **Ingen UI-ændringer på eksisterende faner**
- **Ingen ændringer i beregninger, priser, satser eller datastruktur**

### Undtagelse
👉 **Historik-fanen er den ENESTE fane der må videreudvikles**

Alt fremtidigt arbejde sker **udelukkende** i:
- Historik
- Historik-relateret data
- Historik-lagring, visning og performance

## Faner – regler

| Fane | Status |
|----|----|
| Optælling | 🔒 Låst |
| Sagsinfo | 🔒 Låst |
| Løn | 🔒 Låst |
| Import | 🔒 Låst |
| Export | 🔒 Låst |
| **Historik** | ✅ Aktiv udvikling |

## Historik – tilladt arbejde
- Forbedre lagring (localStorage / IndexedDB)
- Performance-optimering
- Bedre overblik over tidligere sager
- Knytning til eksport-events
- Stabilitet og fejlhåndtering
- Ingen afhængighedsændringer uden eksplicit ordre

## Ikke tilladt
- Nye faner
- Nye dependencies
- Ændring af layout på eksisterende faner
- Ændring af eksisterende eksport/import-flow
- Ændring af beregningslogik

## Mål
Stabil, forudsigelig app.
Ingen overraskelser.
Ingen scope creep.

Alt andet kræver eksplicit godkendelse.
