# SSCaff – kodegennemgang

## HTML – issues og forslag
- [H-01] Canonical peger på forkert domæne
  - Fil: `app/index.html`
  - Beskrivelse: `<link rel="canonical">` er sat til `https://csmate.netlify.app/`, hvilket fortæller søgemaskiner at indholdet "hører til" på et andet domæne end SSCaff. Det giver duplicate-content signaler og gør det sværere for sscaff.netlify.app at blive indekseret korrekt.
  - Forslag: Opdater canonical-URL'en til den faktiske SSCaff-URL (eller fjern tagget helt, hvis siden skal kunne bruges på flere tenants).
  - Type: SEO/bug

- [H-02] Faneknapper mangler semantik til hjælpeteknologi
  - Fil: `app/index.html`
  - Beskrivelse: Navigationsknapperne for "Sagsinfo", "Optælling" og "Løn" styrer visningen af sektioner, men de indgår ikke i et `role="tablist"`, har ikke `role="tab"`, og der er ingen `aria-controls`, så screenreadere kan ikke høre hvilken sektion knappen åbner eller at knapperne opfører sig som faner.【F:app/index.html†L32-L104】
  - Forslag: Brug `role="tablist"` på `<nav>`, `role="tab"` + `aria-controls` på knapperne og `role="tabpanel"` på sektionerne, så relationen er tydelig uden custom JS.
  - Type: accessibility

- [H-03] Numpad-dialogen er ikke annonceret som modal
  - Fil: `app/index.html`
  - Beskrivelse: Den nye numpad har et `role="dialog"`, men mangler `aria-modal="true"` og et `tabindex="-1"`/fokuspunkt på selve panelet. Uden det bliver fokus liggende bag dialogen, og screenreadere kan fortsætte med at interagere med resten af app'en mens overlægget er åbent.【F:app/index.html†L246-L280】
  - Forslag: Giv `.numpad-panel` `aria-modal="true"` og fokusér elementet, når dialogen åbnes, så det opfører sig som en rigtig modal (evt. genbrug fokusstyringen fra guide-modal). 
  - Type: accessibility

## CSS – issues og forslag
- [C-01] Materialelisten bruger faste pixelkolonner
  - Fil: `app/style.css`
  - Beskrivelse: `.material-row` og `.csm-row` har `grid-template-columns: 1fr 88px 110px 110px`, hvilket giver 300+ px faste kolonner oven i navnekolonnen. På smalle mobiler betyder det at rækkerne sprænger viewporten og udløser horisontal scrolling.【F:app/style.css†L81-L140】
  - Forslag: Brug responsive `minmax()` kolonner (fx `clamp`) eller CSS-variablen `--materials-grid` i stedet for faste px-bredder, så layoutet kan kollapse på 320–360 px.
  - Type: responsivitet/bug
  - Status: Løst i Fix-pack B (responsivitet + numpad-tema).

- [C-02] Skalerings-hack giver sløret UI på små skærme
  - Fil: `app/style.css`
  - Beskrivelse: For `@media (max-width:420px)` bliver hele `#app` skaleret med `transform: scale(0.92)` og bredde korrigeres med `width: calc(100%/0.92)`. Det forstørrer indholdet til >100 % af viewporten, skaber ekstra horizontal scroll og gør teksten sløret pga. skalering.【F:app/style.css†L209-L223】
  - Forslag: Drop skalering og i stedet justér paddings/typografi direkte i breakpoints, så appen forbliver 1:1 pixel-mappet.
  - Type: responsiveness/UX
  - Status: Løst i Fix-pack B (responsivitet + numpad-tema).

- [C-03] Numpad-farver ignorerer temaets CSS-variabler
  - Fil: `app/css/numpad.css`
  - Beskrivelse: Den nye numpad bruger hårdkodede farver (#121212, #1f1f1f, #27ae60 osv.) og egne border-radii, så den ikke følger de globale tema-variabler i `:root`. Når resten af appen skifter palette, vil numpaden stå tilbage i andre farver.【F:app/css/numpad.css†L19-L120】
  - Forslag: Erstat faste hex-koder med eksisterende CSS-variabler (`--panel`, `--accent`, `--text`) og lad spacing følge `var(--pad)` for at holde designet konsistent.
  - Type: visual cleanup
  - Status: Løst i Fix-pack B (responsivitet + numpad-tema).

## JS – issues og forslag
- [J-01] SHA-256 er en stub der returnerer samme hash
  - Fil: `app/src/lib/sha256.js`
  - Linjer: ca. 1-9
  - Beskrivelse: `sha256Hex` returnerer en stribe nuller uanset input. Dermed kan ingen af de hashed admin-koder fra JSON/konstanter matches, og sikkerheden er i praksis slået fra (kun `KNOWN_ADMIN_CODES` med klartekst virker).【F:app/src/lib/sha256.js†L1-L9】
  - Risiko: Høj – admin-login virker ikke for tenants der forventer hash-match og stubben giver falsk sikkerhed.
  - Forslag: Udskift stubben med en rigtig `crypto.subtle.digest`-baseret SHA-256 implementering (med fallback) og behold `constantTimeEquals` for at undgå timing-angreb.
  - Status: Fixed in Fix-pack A – rigtig SHA-256 (med Web Crypto + JS fallback) og asynkron adminvalidering er implementeret.

- [J-02] Eksportlib-stubs giver `TypeError`
  - Filer: `app/src/features/export/lazy-libs.js`, `app/main.js`
  - Linjer: ca. 1-9 og 2987-3079
  - Beskrivelse: `ensureExportLibs` og `ensureZipLib` returnerer `undefined`, men `exportPDFBlob` og `exportZip` destrukturerer `{ jsPDF, html2canvas }` og `{ JSZip }`. Når brugeren klikker “Eksportér PDF/ZIP” kaster koden straks en TypeError, før der vises feedback.【F:app/src/features/export/lazy-libs.js†L1-L9】【F:app/main.js†L2987-L3082】
  - Risiko: Høj – eksportfunktionerne kan slet ikke bruges.
  - Forslag: Implementér lazy import (`await import('jspdf')` osv.) og returnér et objekt med de forventede konstruktorer.
  - Status: Fixed in Fix-pack A – eksportlibs og JSZip lazy-loades nu fra CDN og leverer de forventede objekter.

- [J-03] Eval-baseret udregning i numpaden
  - Fil: `app/js/numpad.js`
  - Linjer: ca. 228-244
  - Beskrivelse: `computeExpression()` evaluerer brugerinput via `Function('"use strict"; return (' + safe + ')')`, hvilket betyder at hvilket som helst tastatur-input bliver kørt som JavaScript-udtryk. Selvom tastaturet begrænser tegn, kan fejlkilder (fx `1e9999`) stadig få appen til at kaste eller returnere `Infinity`.【F:app/js/numpad.js†L228-L244】
  - Risiko: Middel – potentielle crashes samt dårlig forudsigelighed.
  - Forslag: Brug en lille parser eller en sikker evaluering (fx `mathjs` light, eller implementér et simpelt stack-baseret regneaggregat) i stedet for `Function`.
  - Status: Fixed in Fix-pack A – numpaden bruger nu en valideret parser fra `safe-eval.js` uden direkte eval.

- [J-04] Eval bruges også i A9-kalkulatoren
  - Fil: `app/js/a9-calc.js`
  - Linjer: ca. 243-259
  - Beskrivelse: Den udvidede A9-beregner gør præcis det samme (`Function('"use strict";return(' + jsExpr + ')')`). Hvis man indsætter et langt udtryk eller `Infinity`, knækker hele kalkulatoren og clipboard-teksten bliver ugyldig.【F:app/js/a9-calc.js†L243-L259】
  - Risiko: Middel – fejl i slæb-procent beregningen kan give forkerte lønninger.
  - Forslag: Genbrug samme sikre parser som foreslået i [J-03].
  - Status: Fixed in Fix-pack A – A9-kalkulatoren anvender samme sikre parser og håndterer NaN/Infinity defensivt.

- [J-05] Scroll-lock klasse bliver aldrig sat
  - Filer: `app/js/numpad.js`, `app/style.css`
  - Linjer: ca. 131-168 og 36-36
  - Beskrivelse: CSS forventer, at `<html>` får klassen `.np-open` for at låse scroll (`:root.np-open { overflow:hidden }`), men `showNumpadForInput`/`hideNumpad` tilføjer kun `.numpad-hidden` på overlægget. Resultat: baggrundens indhold kan stadig scrolles mens man taster på numpaden.【F:app/js/numpad.js†L131-L168】【F:app/style.css†L32-L37】
  - Risiko: Lav/middel – dårlig UX (især på iOS) og risiko for at brugeren mister kontekst.
  - Forslag: Toggle `document.documentElement.classList` i `showNumpadForInput`/`hideNumpad` (og sørg for cleanup).
  - Status: Fixed in Fix-pack A – `.np-open` toggles og CSS låser scrolling når numpaden er åben.

- [J-06] pctcalc-modulet er et tomt stub
  - Fil: `app/src/features/pctcalc/pctcalc.js`
  - Linjer: 1-3
  - Beskrivelse: `main.js` importerer modulet, men filen eksporterer en tom funktion. Det betyder en ekstra HTTP-request uden funktionalitet og gør det uklart om procent-regneren er implementeret eller ej.【F:app/src/features/pctcalc/pctcalc.js†L1-L3】
  - Risiko: Lav – men giver død kode og forvirring.
  - Forslag: Fjern importen indtil funktionen findes, eller implementér de forventede features.
  - Status: Fixed in Fix-pack A – modulet er frakoblet fra `main.js` og markeret som TODO for at undgå død kode.

## Runtime – Console issues
- [R-01] TypeError ved PDF-eksport
  - Besked: `TypeError: Cannot destructure property 'jsPDF' of 'undefined' as it is undefined.` når `ensureExportLibs()` returnerer `undefined` og `exportPDFBlob` forsøger at destructure.【F:app/src/features/export/lazy-libs.js†L1-L9】【F:app/main.js†L2987-L3034】
  - Hvornår: Klik på “Eksportér PDF” eller “Eksportér alt”.
  - Forslag: Implementér reel lazy import og returnér `{ jsPDF, html2canvas }`.
  - Status: Fixed in Fix-pack A – lazy-loaderen indlæser nu jsPDF/html2canvas før eksporten starter.

- [R-02] TypeError ved ZIP-eksport
  - Besked: `TypeError: Cannot destructure property 'JSZip' of 'undefined' as it is undefined.` når `exportZip()` kalder `ensureZipLib()` og dernæst bruger resultatet.【F:app/src/features/export/lazy-libs.js†L1-L9】【F:app/main.js†L3051-L3082】
  - Hvornår: Klik på “Eksportér ZIP”.
  - Forslag: Lazy-load JSZip (fx `await import('jszip')`) og returnér objektet.
  - Status: Fixed in Fix-pack A – JSZip lazy-loades og bruges først når modulet er klar.

## Runtime – funktionelle bugs
- [B-01] Admin-koder fra tenant-JSON kan ikke logges ind
  - Repro:
    1. Prøv at logge ind med den hash-baserede admin-kode fra `data/tenants/hulmose.json`.
    2. Koden bliver hashed via `sha256Hex`, men funktionen returnerer altid nuller.
    3. Forventet: Hash-match accepteres. Faktisk: Kun hardcodede klartekstkoder fungerer.
  - Fil(er): `app/src/lib/sha256.js`, `app/main.js` (`verifyAdminCodeInput`).【F:app/src/lib/sha256.js†L1-L9】【F:app/main.js†L1968-L2028】
  - Forslag: Implementér rigtig hashing eller distribuér klartekst-koder med passende sikkerhed.
  - Status: Fixed in Fix-pack A – admin-login bruger nu ægte SHA-256 hashing og constant-time sammenligning.

- [B-02] Body kan scrolles mens numpaden er åben
  - Repro:
    1. Åbn numpaden på mobil.
    2. Swipe på baggrundsområdet – hele appens indhold bevæger sig bag overlægget.
    3. Forventet: Scroll låses mens modal er aktiv. Faktisk: Intet scroll-lock fordi `.np-open` aldrig bruges.
  - Fil(er): `app/js/numpad.js`, `app/style.css`.【F:app/js/numpad.js†L131-L168】【F:app/style.css†L32-L37】
  - Forslag: Tilføj/afmeld `.np-open` på `<html>` og/eller brug `body { overscroll-behavior: contain; }` når overlægget er aktivt.
  - Status: Fixed in Fix-pack A – `.np-open` sættes nu ved åbning og CSS låser scroll/overscroll.

## Performance & struktur – optimeringsmuligheder
- [P-01] Materialedata er duplikeret tre steder
  - Filer: `app/main.js`, `app/dataset.js`, `app/complete_lists.json`
  - Beskrivelse: De samme BOSTA/HAKI/MODEX arrays ligger som gigantiske konstante i `main.js` (ca. linje 300+), i `dataset.js` og igen i JSON-filerne. Det øger bundle-størrelsen betragteligt og gør det svært at vedligeholde priser ét sted.【F:app/main.js†L300-L360】【F:app/dataset.js†L1-L40】
  - Forslag: Hold datasæt i én JSON/JS-modul og importér dem derfra.
  - Forventet gevinst: Mindre JS, hurtigere indlæsning og mindre vedligehold.

- [P-02] Stor inline-scriptblok i index.html
  - Fil: `app/index.html`
  - Beskrivelse: Der ligger et minificeret `<script>` direkte i HTML'en som gentager logik for `.mat-row`, eksporterer globale funktioner mv.【F:app/index.html†L332-L339】 Det kan ikke cache-bustes uafhængigt og blander forretningslogik ind i HTML.
  - Forslag: Flyt scriptet ind i `main.js` (som modul) og fjern globale sideeffekter.
  - Forventet gevinst: Klarere arkitektur og mulighed for tree-shaking.

- [P-03] Placeholder-moduler loader uden at lave noget
  - Filer: `app/src/features/pctcalc/pctcalc.js`, `app/src/features/export/lazy-libs.js`
  - Beskrivelse: Begge filer eksportere kun stubs, men importeres stadig på første sideindlæsning. Det giver ekstra bytes/requests uden funktionalitet og gør det sværere at se hvad der mangler.
  - Forslag: Enten implementér funktionerne eller fjern importerne indtil de er klar.
  - Forventet gevinst: Mindre JS, klarere TODO-liste.

## UX & responsivitet – issues
- [U-01] Materialerækker klipper tekst på små telefoner
  - Skærmstørrelse: 360×640 og mindre
  - Beskrivelse: De faste kolonnebredder i `.material-row` tvinger navnekolonnen til få plads; resultatet er at materialenavne bliver klippet eller kræver horizontal scroll, hvilket gør optælling besværlig.【F:app/style.css†L81-L140】
  - Forslag: Brug fleksible kolonner eller stack felterne (fx navn over pris) under 400 px bredde.
  - Status: Løst i Fix-pack B (responsivitet + numpad-tema).

- [U-02] Skaleringstricket gør hele appen utydelig
  - Skærmstørrelse: <420 px
  - Beskrivelse: `transform: scale(0.92)` på hele appen giver en zoomet/flimrende oplevelse og ændrer touch-targets’ fysiske størrelse, hvilket især går ud over tastbare elementer nær kanterne.【F:app/style.css†L209-L223】
  - Forslag: Tilpas spacing/typografi med medier queries i stedet for at skalere hele DOM’en.
  - Status: Løst i Fix-pack B (responsivitet + numpad-tema).

- [U-03] Numpad deler ikke tema med resten af UI’et
  - Skærmstørrelse: Alle
  - Beskrivelse: Den mørke numpad bruger egne farver og kontraster, så komponenten "stikker ud" visuelt fra resten af UI'et og virker som et fremmed modul. For brugere i mørke omgivelser betyder det skarpe kontraster og dårlig visuel hierarki.【F:app/css/numpad.css†L19-L120】
  - Forslag: Bind farverne til eksisterende tema-variabler og match knaphøjder/typografi med resten af appen.
  - Status: Løst i Fix-pack B (responsivitet + numpad-tema).

## Samlet oversigt
| ID   | Type                   | Severity | Kort beskrivelse |
|------|------------------------|----------|------------------|
| H-01 | HTML/SEO               | Middel   | Canonical peger på forkert domæne |
| H-02 | HTML/a11y              | Middel   | Faner mangler roles/aria-controls |
| H-03 | HTML/a11y              | Middel   | Numpad-dialogen er ikke annonceret som modal |
| C-01 | CSS/responsivitet      | Høj      | Materialeliste bruger faste px-kolonner |
| C-02 | CSS/UX                 | Middel   | Skalering af hele appen giver sløret UI |
| C-03 | CSS/visual             | Lav      | Numpad ignorerer tema-variabler |
| J-01 | JS/security            | Høj      | SHA-256 stub ødelægger admin-login |
| J-02 | JS/runtime             | Kritisk  | Eksport-libs er undefined → TypeError |
| J-03 | JS/runtime             | Middel   | Eval-baseret numpad kan kaste/returnere Infinity |
| J-04 | JS/runtime             | Middel   | Eval bruges i A9-kalkulatoren |
| J-05 | JS/UX                  | Middel   | Scroll-lock klasse bruges ikke |
| J-06 | JS/cleanup             | Lav      | pctcalc er tomt stub-modul |
| R-01 | Runtime/console        | Kritisk  | PDF-eksport kaster TypeError |
| R-02 | Runtime/console        | Kritisk  | ZIP-eksport kaster TypeError |
| B-01 | Runtime bug            | Høj      | Tenant admin-koder kan ikke logge ind |
| B-02 | Runtime bug            | Middel   | Baggrunden kan scrolles mens numpad er åben |
| P-01 | Performance/struktur   | Middel   | Materialedata er duplikeret tre steder |
| P-02 | Performance/struktur   | Middel   | Inline script gør vedligehold tung |
| P-03 | Performance/struktur   | Lav      | Placeholder-moduler loader uden funktionalitet |
| U-01 | UX/responsivitet       | Høj      | Materialerækker klipper tekst på små skærme |
| U-02 | UX/responsivitet       | Middel   | Skalering skader touch-oplevelsen |
| U-03 | UX/visual              | Lav      | Numpad matcher ikke temaet |

_Fix-pack A (admin + eksport + eval + numpad scroll-lock) er implementeret og testet manuelt i browser._
_Fix-pack B (CSS/responsivitet + numpad-tema) er implementeret og testet på 320–414 px viewport bredde._
