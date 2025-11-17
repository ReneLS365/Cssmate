# Cssmate – Tabs & Feature Review

**Resume**
- Fanestyring genopbygget med central `setActiveTab` og gemt tilstand.
- Modal- og numpad-flow gennemgået med fokus på fokus-håndtering.
- Eksport-/Excel-funktionerne er kodereviewet; E-komplet knapper mangler stadig markup.
- Auth, offline og layout blev sanity-checket for klik-guards, PWA hooks og responsivitet.

## Tabs & Navigation
- **Checks**: Gennemgået `app/main.js` for tab-init, tastaturstyring og skjul/vis af paneler. Testede mapping mellem `data-tab-target` og `tab-panel` markup i `app/index.html`.
- **Findings**: `setActiveTab` accepterede kun knapper, skiftede ikke `aria-hidden`, og faner huskede ikke sidste valg (app/main.js ca. 125-205). Kun tre faner er til stede i HTML, så Job/Historik/Hjælp-faner fra kravspec findes ikke (app/index.html ca. 32-120).
- **Fixes**: Omskrevet `initTabs` med map mellem knapper og paneler, `aria-hidden` toggles, `tabindex` styring, tastatur (pil, Space/Enter) og localStorage (`cssmate:lastActiveTab`). Eksporterede helper til `window.__cssmateSetActiveTab` til debugging.
- **Open issues**: De manglende faner (Job/Historik/Hjælp) kræver markup/designbeslutning før logikken kan håndtere dem.

## Modaler
- **Checks**: Validerede guide-modalens open/close-logik (`app/main.js` ca. 60-123) inkl. baggrundsklik og Escape. Bekræftede at modalen bruger `aria-hidden`.
- **Findings**: Ingen kritiske fejl; manglende inline-kommentarer gjorde koden sværere at følge.
- **Fixes**: Tilføjede korte forklarende kommentarer omkring `openGuideModal` og `closeGuideModal`.
- **Open issues**: Overvej om guiden skal have egentligt fokus-trap og tab-cyklus – kræver UX-afklaring.

## Numpad / Lommeregner / A9
- **Checks**: Gennemgik `app/js/numpad.js` og `app/js/a9-calc.js` for fokusflow, commit-events og baggrundsluk. Sikrede at numpad rydder 0-værdier og at A9-commit udsender events.
- **Findings**: Når man gemte via numpad, blev fokus ikke returneret til feltet (app/js/numpad.js ca. 170-205). A9-lommeregneren huskede ikke tidligere fokus og kunne efterlade brugeren uden fokusmarkør (app/js/a9-calc.js ca. 71-125).
- **Fixes**: `hideNumpad` returnerer altid fokus til sidste felt, uanset commit, og A9-panelet gemmer/retablerer fokus samt har dokumenterede open/close-kommentarer.
- **Open issues**: Ingen yderligere uden for krav; numpad mangler evt. visuel feedback på aktivt felt hvis ønsket.

## Export (CSV/JSON/E-komplet/Zip)
- **Checks**: Review af `validateSagsinfo` og init-blokken der binder `btnExport*` events (app/main.js ca. 1305 & 3289-3305). Verificerede `exportAll`, `exportZip` og prefetch af bibliotek.
- **Findings**: Event-handlers bindes til `btnExportCSV`, `btnExportAll` og `btnExportZip`, men ingen af disse knapper findes i `app/index.html`, så brugeren kan ikke trigge eksportflow uden custom build.
- **Fixes**: Ingen kodeændring mulig uden UX-accept; dokumenteret som kritisk blokering.
- **Open issues**: Kræver beslutning om hvor og hvordan eksportknapperne skal reintroduceres i UI'et.

## Excel (25-ark)
- **Checks**: Gennemgang af `app/src/export/akkord-excel.js` for datasetvalg, template fetch og fejlmeldinger. Sikret at `selectSystem` prioriterer jobdata korrekt.
- **Findings**: Ingen funktionelle fejl, men funktionen manglede kontekst og kunne misforstås under review.
- **Fixes**: Tilføjet inline-kommentar før `exportAkkordExcelForActiveJob` og valideret at fejlhåndtering viser beskeder via eksisterende statusfunktioner.
- **Open issues**: Ingen – men kræver reelle data for end-to-end test ved næste QA.

## Auth / Offline
- **Checks**: Verificeret at `login()` binder til `btnAdminLogin` og at `initClickGuard` beskytter `[data-requires-admin]` felter (app/main.js ca. 1805-1840 & app/src/ui/Guards/ClickGuard.js ca. 1-25). Gennemgik `hardResetApp` og PWA-install prompt wiring.
- **Findings**: Ingen direkte fejl; offline/hard reset kræver browser-test, hvilket ikke er muligt i headless miljø.
- **Fixes**: Ingen nødvendige.
- **Open issues**: Teamet bør bekræfte, om hard-reset skal være synlig for admin som nu (skjult bag `btnHardResetApp`) eller skjules helt.

## Layout / Responsiv
- **Checks**: CSS (`app/style.css`) for tab-nav flex-wrap, sticky header og materials-scroll overscroll. Smal viewport support via `max-width` og `100dvh` fallback.
- **Findings**: Layout håndterer 3 faner fint, men ekstra faner fra kravspec vil presse nav'et; kræver designinput før udvidelse.
- **Fixes**: Ingen direkte ændringer, men tabmotor understøtter nu flere faner uden ekstra CSS.
- **Open issues**: UX skal validere hvordan seks faner skal vises på mobil (horisontal scroll eller 2 rækker).

## A11y
- **Checks**: Fokus på ARIA-attributter for tablist/panels og skip-link. Tjekkede modaler for Escape support og aria-hidden toggles.
- **Findings**: Tabpanelet skjulte ikke `aria-hidden`, og knapper manglede keyboard-aktivering via Space/Enter.
- **Fixes**: `initTabs` sætter `aria-hidden`, `tabindex`, gemmer/indlæser sidste faner, og keyboard shortcuts er på plads. Guide/numpad/A9 modaler returnerer fokus.
- **Open issues**: Når flere faner kommer tilbage, skal tab-order og aria-labels opdateres tilsvarende.

## Severity overview

| Area | Status | Severity | Notes |
|------|--------|----------|-------|
| Tabs | OK | High | Persist + kbd fix |
| Modaler | OK | Low | Fokus returneres |
| Numpad | OK | Medium | Fokus bug løst |
| Export | Needs fix | High | Mangler knapper |
| Excel | OK | Medium | Kommenteret |
| Auth/Offline | Partially OK | Medium | Hard reset UX? |
| Layout/Responsiv | Needs input | Medium | Flere faner mangler design |
| A11y | OK | Medium | Tab aria opdateret |
