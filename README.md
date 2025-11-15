# Sscaff – simple/mobile deploy snapshot

Denne mappe indeholder `app/`-mappen klar til at blive lagt direkte ind i dit `sscaff-v1` GitHub-repo.

Materialelisterne indlæses nu fra `src/data/complete_lists.json`, og service-workerens precache er opdateret til at håndtere filen offline.

Kopier hele `app/`-mappen ind i roden af repoet (eller på en ny branch), commit, og deploy via Netlify.

UI-justeringer sikrer bedre mobilnavigation og formularlayout, og navngivningen er opdateret til Sscaff på tværs af manifest, metadata og lokale nøgler.

Excel-eksporten anvender de originale skabeloner, som forventes placeret i `src/data/excel/` og deklareret i `src/data/excel/templates.json`. Hver gang du opdaterer disse filer, skal service-workerens cache-version opdateres eller bumpes, så offline-brugere får de nye skabeloner.
## Arkiver

Alle zip-arkiver er nu samlet i mappen `archives/` for at holde roden ryddelig.
