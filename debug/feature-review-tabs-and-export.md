# Cssmate – Tabs & Feature Review

- Genopbyggede faner med seks sektioner og vedvarende lokal tilstand.
- Reintroducerede eksporthandlinger med knapper til CSV, JSON, ZIP og E-komplet.
- Stabiliserede numpad og A9-lommeregner med fokusretur og commit-events.
- Forenklede modal- og guard-logik for bedre mobilvenlighed.
- Dokumenterede status i tabel med vurderet severity.

## Tabs & Navigation
**Checks**: app/index.html, app/style.css, app/main.js (tabmotor).

**Findings**: App sad fast på Sagsinfo pga. gammel tab-logik (app/main.js ca. l.120). Manglende faner (Historik/Hjælp) og ingen localStorage fallback.

**Fixes**: Nyt semantisk tablist-markup, central `setActiveTab`, tastatursupport og mobil-scrollbar. Tilføjet defensive guards og logging hvis en fane eller et panel mangler så navigationen ikke sætter sig fast. Dynamisk historikliste (`app/index.html`, `app/main.js`) viser nu seneste sager fra IndexedDB med summer og tidsstempel så fanen har reelt indhold.

**Open issues**: Ingen – historikpanelet opdateres nu automatisk.

## Modaler
**Checks**: app/main.js (guide-modal), app/style.css.

**Findings**: Fokus blev ikke returneret ved lukning, ingen aria flag.

**Fixes**: Gem tidligere fokus, brug `data-open`, Escape-lyttere aktiveres nu kun mens modalen er åben så tastetryk ikke hijackes globalt. Bekræftet at numpad- og A9-modalernes `aria-hidden`/fokus-flow matcher samme mønster, så ingen ekstra guards er nødvendige.

**Open issues**: Ingen.

## Numpad / Lommeregner / A9
**Checks**: app/js/numpad.js, app/js/a9-calc.js, app/css/numpad.css, app/index.html.

**Findings**: Numpad krævede dobbeltklik for commit og mistede fokus. A9 udsendte kun `a9-commit` event og returnerede fokus til forkert element.

**Fixes**: Fokus fastholdes på input, change-event udsendes, overlay lukker via options. A9 udsender både `a9-commit` og `a9:commit` og returnerer fokus. Numpad/A9 binder kun knapper hvis de findes og display-opdatering er guarderet, så man undgår JS-fejl ved manglende markup. Manuelle ændringer i slæb-% opdaterer nu hjælpeteksten med aktuel værdi, så brugeren kan se hvilken værdi der er aktiv, også uden ny A9-commit.

**Open issues**: Ingen.

## Export
**Checks**: app/index.html, app/main.js (initExportButtons, onExport*), export helpers.

**Findings**: Eksportknapper manglede helt i UI og event bindinger var døde kode.

**Fixes**: Ny knapgruppe, central init med prefetch, E-komplet knap kører Excel efter indberetning. Alle eksportknapper skriver nu status via det fælles `actionHint`-område (`role="status"`), så brugeren får både succes- og fejlbeskeder uden ekstra UI.

**Open issues**: Ingen.

## Excel (25-ark)
**Checks**: app/main.js (populateExcelSystemSelect, onExportEkomplet), app/src/export/akkord-excel.js import.

**Findings**: Ingen måde at vælge system, Excel-knap manglede.

**Fixes**: Statisk select + dynamisk population, systemvalg gemmes i storage og bruges under eksport. Excel-dropdown viser nu tydeligt hvilke systemer der ikke er aktive i den aktuelle sag (tekst + styling i `app/style.css`).

**Open issues**: Ingen.

## Auth / Offline
**Checks**: app/main.js (login, initApp), app/src/ui/Guards/ClickGuard.js.

**Findings**: ClickGuard bandt events selvom ingen admin-kontroller, hvilket var unødigt.

**Fixes**: Guard binder kun ved relevante targets; login allerede null-sikret. Admin-hard-reset knappen spejler nu den reelle admin-tilstand (skjules + disablet indtil log ind) og følger `csmate:admin-change` events. Login-knappen understøtter nu eksplicit logout (tomt input når admin er aktiv), hvilket rydder state og opdaterer UI uden ny knap.

**Open issues**: Ingen.

## Layout / Responsiv
**Checks**: app/style.css (tabs, tab-panels, job/eksport), app/index.html struktur.

**Findings**: Ingen horisontal scroll på tab-bar, faste højder gav scroll jitter.

**Fixes**: Flex-baseret tab-bar med scroll-snap, tab-paneler har egen scrollhøjde og max-width. Mobile padding, base font-size og form-actions er justeret med `clamp`/media queries så 320–768px ikke giver overflow.

**Open issues**: Ingen – panelhøjder følger nu viewport med `100dvh` og clamps.

## A11y
**Checks**: app/index.html (role/aria), app/main.js (tab fokus, modal aria).

**Findings**: ARIA-attributter var inkonsistente (data-tab-target vs. aria-controls).

**Fixes**: Ensartede `data-tab-id` / `aria-controls`, keyboard support, aria-hidden toggles.

**Open issues**: Ingen – historiklisten er aria-live og job-hints/status bruger nu `role="status"`.

| Area            | Status | Severity | Notes                |
|-----------------|--------|----------|----------------------|
| Tabs            | OK     | High     | Historik aktiv       |
| Modaler         | OK     | Low      | Fokus + guards       |
| Numpad          | OK     | Medium   | Hjælpetekst i sync   |
| Export          | OK     | High     | Status via hint      |
| Excel           | OK     | Medium   | Inaktive tydelig     |
| Auth/Offline    | OK     | Medium   | Logout via login     |
| Layout/Responsiv| OK     | Medium   | Mobile padding tuned |
| A11y            | OK     | Medium   | Live status/historik |
