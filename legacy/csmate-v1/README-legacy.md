# legacy/ – gammel CSMate-kode (ARKIV)

Denne mappe indeholder **gamle versioner** af CSMate, kun som reference.

## Struktur

- `legacy/csmate-v1/`
  - `csmate-v1.zip`  
    ZIP fra den første CSMate-app. Indeholder:
    - materialelister + priser
    - beregningslogik (materialesum, lønsum, projektsum)
    - løn-funktioner (fx “tilføj mand”)
    - eksport-funktioner (CSV/JSON)
    - en masse ting vi *ikke* længere bruger (jobs, login, admin, osv.)

## Regler for brug (til Codex / udviklere)

1. **Må bruges til:**
   - At kopiere:
     - materialelister (BOSTA/HAKI/MODEX/ALFIX)
     - priser, vægt, varenr osv.
     - formler og beregningslogik til materialesum, løn og projektsum
     - eksport-funktioner (CSV/JSON) til den nye app
   - At forstå hvordan den gamle løn-logik fungerede.

2. **Må IKKE bruges til:**
   - At aktivere gamle features direkte i build’et:
     - job-lister / job-fane
     - brugere, login, Auth0, roller, admin-paneler
   - At flytte gamle HTML/CSS ukritisk ind i den nye app.
   - At tilføje flere komplekse features end nødvendigt.
   
3. **Mål for den nye app (Cssmate):**
   - KUN faner:
     - Sagsinfo
     - Optælling
     - Løn
     - Historik
     - Hjælp
   - Ingen login, ingen admin, ingen jobstyring.
   - Simpelt, hurtigt, mobil-først og brugbart for alle montører.

## Noter

- Filerne her er **arkiv**.  
- Al aktiv logik skal ligge under den normale kildekode (fx `/js`, `/src` eller lignende).  
- Hvis der kopieres funktioner/formler herfra, så:
  - rens koden
  - omdøb til klare navne
  - tilføj kommentar øverst, fx:

    ```js
    // Porteret fra legacy/csmate-v1 – tilpasset til Cssmate (simpel akkordseddel)
    ```

Så: legacy = bibliotek, ikke en ekstra app. Alt nyt sker i Cssmate-koden.
