# SSCaff release- og QA-rapport

Denne rapport opsummerer den nuværende stand af SSCaff/CSMate-applikationen, fokusområderne fra denne leverance samt praktiske noter til drift, prisvedligeholdelse og support.

## Appens formål og hovedmoduler
- **Formål**: Web/PWA-værktøj til stilladsfirmaer for at håndtere sagsstamdata, optælling af materialer og akkord-/lønberegninger. Hele flowet ligger i `app/index.html`, mens interaktioner drives fra `app/main.js` og tilhørende moduler i `app/src/`.
- **Sagsinfo** (`#panel-sagsinfo`): Stamdata, historik og statussektioner der holder sagens metadata. Formularstrukturen følger kravene fra entrepriseaftaler og danner grundlag for eksport.
- **Optælling** (`#panel-optaelling`): Materialevalg, virtuelle lister og filter til at vise kun valgte materialer. UI’et renderes af `renderOptaelling()` i `app/main.js`, der kombinerer datasets fra `app/dataset.js` med brugerinput.
- **Løn** (`#panel-lon`): Indeholder eksportknapper (CSV/JSON/ZIP/E-komplet), resultatvisning, medarbejderstyring samt admin-sektion med klikbeskyttelse fra `app/src/ui/Guards/ClickGuard.js`. Beregningerne ligger primært i `app/src/modules/calculateTotals.js` og tilhørende helpers.
- **Hjælp** (`#panel-hjaelp`): Kort how-to samt supporthint; suppleret af guide-modal i bunden af `index.html` og styringslogik i `setupGuideModal()` i `app/main.js`.

## Tabs og tilgængelighed
- HTML-strukturen er ensrettet: knapperne i `<nav class="tabs">` bruger `data-tab-id`, `aria-controls` og `role="tab"`, mens panelerne bruger `data-tab-panel` + `role="tabpanel"` og `aria-labelledby`. Kun Sagsinfo-panellet starter med `tab-panel--active` og `aria-hidden="false"` (`app/index.html`).
- `setActiveTab` og `initTabs` i `app/main.js` er gjort mere robuste: fanekollektionerne genopbygges hvis DOM ændres, ARIA-attributter opdateres konsekvent, og keyboardnavigation (Pil højre/venstre, Home/End, Enter/Space) fastholdes.
- CSS for `.tab-panel`/`.tab-panel--active` i `app/style.css` sørger for at kun aktive paneler vises, også hvis JavaScript er midlertidigt inaktivt.

## PWA/service worker og cache-versionering
- `app/service-worker.js` har nu `const SW_VERSION = "__SW_VERSION__"` og cache-navne der prefixes med `sscaff-runtime-`. Install-event prewarmer Workbox-precachen og opretter den versionsbestemte runtime-cache, mens activate-event sletter gamle caches og kalder `clients.claim()`.
- Build-skriptet `scripts/bump-sw-version.js` udskifter placeholderen med et UTC-tidsstempel (`V-YYYYMMDDTHHMMSSZ`). Netlify kører automatisk `npm run build`, der igen kalder bump-skriptet, før `app/` udgives (`netlify.toml`).
- Resultat: hver deploy giver et nyt service worker-version ID, hvilket tvinger browsere til at hente den nye SW og kassere forældede caches.

## Pris- og datavedligeholdelse
- Prisgrundlaget ligger i `app/complete_lists.json` (priskurant/hvidbog). Arbejdsdataset til UI’et ligger i `app/dataset.js` og bruges af `app/main.js` via `getSystemList`/`getAllSystems`.
- Scriptet `scripts/update-price-lists.js` matcher beskrivelser fra `complete_lists.json` mod dataset-arrays (BOSTA/HAKI/MODEX/Alfix) og opdaterer `pris`-felterne. Kør `npm run update-prices` efter at prislisterne er opdateret for automatisk at regenerere `dataset.js`.
- Scriptet logger hvor mange priser der blev matchet pr. system og viser de første manglende beskrivelser, så datateamet nemt kan tilføje eventuelle nye varenumre.

## Deploy- og supporttjekliste
- **Build**: `npm install` (første gang) og derefter `npm run build` før deploy. Kommandoen opdaterer kun service workerens version, så `app/` kan stadig udgives som statisk mappe.
- **Test faner**: Klik og tastatur (Enter/Space) på Sagsinfo, Optælling, Løn og Hjælp for at sikre at kun ét panel er synligt. Reload for at bekræfte at sidste faneblad genskabes via `localStorage`.
- **PWA**: Efter deploy – åbn DevTools → Application → Service Workers og kontroller at runtime-cachen hedder `sscaff-runtime-V-...` og at gamle caches er fjernet.
- **Prisopdatering**: Når priskuranten eller hvidbogen ændres, opdater `app/complete_lists.json` og kør `npm run update-prices`. Commit både JSON- og dataset-ændringer sammen for fuld sporbarhed.

## Fakta om løsningen
- Komplet offline-ready PWA (manifest + service worker) målrettet byggepladser uden stabil forbindelse.
- Indeholder egen numpad (`app/js/numpad.js`) og A9-slæbberegner-integration (`setupA9Integration` i `app/main.js`).
- Eksportmuligheder: CSV/JSON/ZIP samt specialeksport til E-komplet (`app/src/export/`), suppleret af historiklog i `debug/`-mappen.
- Admin- og supportværktøjer: klikguard, adminkode fra `app/data/tenants/hulmose.json`, guide-modal og hard reset funktion der rydder SW, caches og IndexedDB (`hardResetApp()` i `app/main.js`).

Denne rapport bør vedlægges release notes, så alle miljøer ved præcis hvad der er opdateret, hvordan tabs fungerer, og hvordan PWA/service worker-versionering samt prisjusteringer håndteres fremover.
