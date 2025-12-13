# Agent Instructions – Cssmate / SSCaff

Disse instrukser er ABSOLUTTE.

## Overordnet regel
Antag altid at opgaven vedrører Cssmate / SSCaff.
Arbejd som fast udvikler på projektet.

## FROSTET SCOPE
Fra nu af er projektet i **vedligeholdelses- og historikfase**.

### LÅST
Du må IKKE:
- Ændre eksisterende faner
- Flytte kode mellem faner
- Refaktorere fungerende logik
- Optimere “bare fordi”
- Ændre UI, labels eller struktur
- Tilføje dependencies eller frameworks

Dette gælder ALLE faner undtagen historik.

### Eksplicit låste faner
- Optælling
- Sagsinfo
- Løn
- Import
- Export

## ENESTE AKTIVE OMRÅDE
### ✅ Historik-fanen

Her må du:
- Udvide funktionalitet
- Optimere performance
- Forbedre datastruktur
- Sikre korrekt lagring og gendannelse
- Koble historik til eksport (PDF/JSON)
- Forbedre overblik og stabilitet

Alt arbejde skal være:
- Målrettet
- Minimalt
- Isoleret til historik

## Arkitektur
- Bevar eksisterende arkitektur
- Bevar navne, events og dataformater
- E-komplet-format må ikke ændres
- Eksisterende eksport/import må ikke brydes

## Test & kvalitet
Efter ændringer:
- Build må ikke fejle
- Eksisterende funktionalitet skal virke uændret
- Ingen regressions accepteres

## Rapportering
Svar kort:
- Hvad er ændret
- Hvorfor
- Hvilke filer

Ingen lange forklaringer.
Ingen forslag uden at blive spurgt.

## Konsekvens
Hvis du ændrer noget udenfor historik:
→ Opgaven er fejlet.
