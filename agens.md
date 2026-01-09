# Agent Instructions – Cssmate / SSCaff

Disse instrukser er ABSOLUTTE.

## Overordnet regel
Antag altid at opgaven vedrører Cssmate / SSCaff.
Arbejd som fast udvikler på projektet.

## FROSTET SCOPE
Fra nu af er projektet i vedligeholdelsesfase.

### LÅST (gælder som udgangspunkt)
Du må IKKE:
- Ændre eksisterende faner
- Flytte kode mellem faner
- Refaktorere fungerende logik
- Optimere “bare fordi”
- Ændre UI, labels eller struktur
- Tilføje dependencies eller frameworks

### Eksplicit låste faner (må ikke ændres)
- Optælling
- Sagsinfo
- Løn
- Import
- Export

## AKTIVE OMRÅDER
### ✅ Historik-fanen
Som før.

### ✅ Team-fanen (kun for invite/membership)
Tilladt:
- Invite-flow uden email (copy link)
- Membership admin (roller, tilføj/fjern)
- Nødvendige UI-tilføjelser i Team

Må ikke:
- Ændre global styling der påvirker låste faner
- Ændre data-/beregningslogik til låste faner

## UNDtagelse: Firebase udfasning (godkendt)
Denne undtagelse er aktiv for opgaven: “Fjern Firebase + nyt invite/auth”.

Tilladt:
- Fjerne Firebase deps og kode
- Erstatte auth/storage for Team + invites
- Tilføje nødvendige dependencies (kun hvis nødvendigt)

Stadig ikke tilladt:
- Ændringer i låste faner eller deres beregninger/eksport/import


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
