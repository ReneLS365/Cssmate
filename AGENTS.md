# AGENTS.md

Styring af AI-/Codex-arbejde i `ReneLS365/Cssmate`

Formålet med denne fil er at sikre, at alle AI-/Codex-agenter arbejder på samme måde:
- Ingen halve løsninger.
- Ingen ødelagt layout eller UX.
- Alle features er færdige, testede og brugbare i praksis for stilladsmontører.

---

## NY POLICY (UI navigation + auth gating)

**Tilladt at ændre UI/navigation/gating i:**
- `src/auth/**`
- `src/ui/**`
- `src/app/**`
- `src/pages/**`
- `src/state/**`
- `js/shared-auth.js`

**Forbudt at ændre forretningslogik i:**
- `src/prices/**`
- `src/calc/**`
- `src/export/**`
- `src/import/**`
- `src/counting/**`
- `src/scaffold/**`
- alt der ændrer output af beregninger/priser

**Policy:**
- Frozen tabs må fjernes, men beregnings- og dataflow må ikke ændres.
- Ingen ændringer i bundle-filer i `dist/` eller genererede assets.

---

## Allowed work (Delt sager + Team + Auth + server + ops docs, safe perf + cleanup policy)

**Tilladt arbejde:**
- Små, fuldt isolerede bugfixes.
- Performance/responsiveness/build-time forbedringer uden adfærdsændringer.
- Ryd op i dødt/ubrugt kode/aktiver **kun** når det er dokumenteret ubrugt.
- Arbejde begrænset til **Delt sager**, **Team**, **Auth**, **Netlify Functions**, **DB migrations** og **drifts-/operations-dokumentation**.

**Ikke tilladt:**
- Store refactors.
- Nye dependencies uden eksplicit godkendelse (medmindre det er omfattet af en aktiv undtagelse).
- Ændringer i delte utilities/komponenter, hvis der er risiko for regression i beregnings- og dataflow.
- Ændringer i priser/calc/export/import/counting/scaffold eller andet der ændrer output af beregninger/priser.

---

## Exception: Legacy auth removal + Invite-flow refactor (approved)

Denne undtagelse er aktiv for opgaven: “Invite-flow uden email (copy link) + fjern legacy auth”.

### Tilladt under denne undtagelse
- Fjernelse af legacy auth (deps, init, auth-kald, configs og env vars).
- Tilføjelse af nødvendige backend-komponenter til auth og invites (serverless/API + DB).
- Nye dependencies er tilladt, men kun hvis de er nødvendige (fx bcrypt/argon2 eller DB client).
- Nye filer og endpoints er tilladt.
- Ændringer i Team-fanen er tilladt (UI + flows).

### Stadig IKKE tilladt
- Ændringer i priser, datasæt, løn-/akkord-beregninger, materialeliste-logik, eksport-mapping eller import/eksport-kontrakter.
- Global CSS eller shared komponent-CSS der kan påvirke beregnings- og dataflow.

### Isolation-krav
- Nye auth/invite ændringer må ikke ændre adfærd i beregnings- og dataflow.
- Routing må udvides (fx /accept-invite, /login) men må ikke ændre eksisterende faners URL/filnavne.
- Hvis der findes shared auth-state, skal den ændres på en måde der er bagudkompatibel for eksisterende faner.

### Dokumentation (krævet i PR)
- Liste over alle fjernede Firebase-filer/afhængigheder.
- Liste over nye endpoints og DB-tabeller.
- Manuel mobil smoke-test af core flows (samme checklist som før).

---

## Exception: Release-hardening for Delt sager (approved)

Denne undtagelse er aktiv for opgaven: “Release-hardening for Delt sager”.

### Tilladt under denne undtagelse
- `netlify/functions/api.mjs` ændringer begrænset til:
  - Server-side pagination for case list.
  - Preview/prod write-guard.
  - Backup export options.
- `netlify/functions/api.mjs` optimeringer til:
  - ensureTeam upsert (single-query).
  - Server-Timing instrumentation uden secrets.
- `netlify/functions/_db.mjs` ændringer begrænset til:
  - Sikker env var resolution (DATABASE_URL kandidater).
  - Migrations-runner opdateringer.
- `netlify/functions/_db.mjs` single-flight init (undgå parallel init-spikes).
- Nye migration-filer under `netlify/functions/migrations/*`.
- `docs/DB_BACKUP.md` (eller lignende) og README-snippets for env contexts.
- UI-ændringer i Delt sager til pagination/Load more (kun performance/UX).
- Scheduled backup til Netlify Blobs (serverless function + docs).

### Stadig IKKE tilladt
- Ændringer i priser, datasæt, løn-/akkord-beregninger, materialeliste-logik, eksport-mapping eller import/eksport-kontrakter.
- Global CSS eller shared komponent-CSS der kan påvirke beregnings- og dataflow.
- Ændringer i bundle-filer i `dist/` eller genererede assets.

---

## Exception: Ultra-review hardening (approved)

Denne undtagelse er aktiv for opgaven: “Ultra-review + hardening (post-merge)”.

### Tilladt under denne undtagelse
- Delt sager pagination + load-more UI guardrails.
- `netlify/functions/_db.mjs` single-flight init.
- `netlify/functions/api.mjs` preview write-guard + Server-Timing.
- `netlify/functions/_context.mjs` helper til deploy-context.
- `netlify.toml` redirects/headers.
- `netlify/functions/_log.mjs` log-sanitizer util.
- `docs/ENV.md` (env/preview safety note).

### Stadig IKKE tilladt
- Ændringer i priser, datasæt, løn-/akkord-beregninger, materialeliste-logik, eksport-mapping eller import/eksport-kontrakter.
- Global CSS eller shared komponent-CSS der kan påvirke beregnings- og dataflow.
- Ændringer i bundle-filer i `dist/` eller genererede assets.

---

## Preview safety contract

- I non-production deploy contexts skal writes **blokeres server-side**.
- Deploy preview env vars må **ikke** pege på production DB.

---

## Definition of Done (Release-hardening)

- Production: create/update/list virker, pagination virker, DK date filter er stadig korrekt.
- Preview: read ok, writes returnerer 403 med tydelig besked.
- Backup: export producerer en downloadbar fil.
- Ingen ændringer i business logic outputs.

## Verification checklist (build/tests + manual mobile smoke)

**Automatiserede checks:**
- `npm run build`
- `npm test` (og øvrige relevante scripts, hvis de findes)

**Manuel mobil-smoke (skal dokumenteres):**
- Sagsinfo: ingen errors.
- Optælling: totals/inputs uændrede.
- Løn: beregninger uændrede.
- Delt sager: ingen errors.
- Historik/Team/Hjælp: forbedringer fungerer og er fejlfrie.

**Compliance:**
- Ingen ændringer i pris-/calc-/data-filer.
- Ingen ændringer i beregnings- og dataflow.

---

## Repo-scan workflow (lokal)

- Kør `node tools/repo-scan.mjs` lokalt, når du skal indsamle logs og baseline-status.
- Opsummér de vigtigste fund i `docs/repo-scan-findings.md`.
- Scan-rapporter under `reports/repo-scan/` er lokale artefakter og må ikke commit’es (kun `.gitkeep`).
- Hvis logs skal deles, zip `reports/repo-scan/` og vedhæft som GitHub-issue eller CI-artifact.

---

## PR checklist (business-logic compliance statement required)

- [ ] Beskriv **hvad** der ændrede sig og **hvorfor**.
- [ ] List alle berørte filer.
- [ ] List kommandoer der er kørt (build/tests).
- [ ] Notér manuelle smoke-tests.
- [ ] **Business-logic compliance:** eksplicit erklæring om at beregnings-/dataflow ikke er ændret.

---

## Cleanup policy (remove only proven-unused items)

- Fjern kun kode/aktiver når de er **bevist** ubrugt.
- Ingen “gæt” på oprydning i delte områder.
- Ingen TODO/FIXME i ændrede filer.

---

## 1. Projekt-kontrakt (ALDRIG bryd disse)

### 1.1 Stack og arkitektur

- App-navn: **Sscaff / Cssmate**
- Repo: `ReneLS365/Cssmate`
- Stack:
  - Ren **HTML**, **CSS**, **Vanilla JS**
  - Ingen bundler (ingen Webpack/Vite/Rollup osv.)
  - Ingen frameworks (ingen React, Vue, Svelte, Angular)
  - PWA med `service-worker.js` + `manifest.webmanifest`
- Målgruppe:
  - Stilladsmontører på mobiltelefon
  - Skal være hurtig, enkel og meget robust

**MUST NOT:**
- Tilføje frameworks eller bundlere.
- Flytte hele appen over i SPA-framework.
- Ændre URL-struktur eller filnavne uden meget klare grunde.

---

### 1.2 Layout-lock og UX-regler

#### Materialeliste

Materialelisten er kritisk og **låst** i struktur:

- Hver materialerække (`.material-row`) skal have præcis 4 kolonner:

  1. **Navn** (`.col-name`)
  2. **Antal** (`.col-qty`) med custom numpad
  3. **Pris** (`.col-price`)
  4. **Linjetotal** (`.col-total`)

- Rækkefølgen og semantikken må ikke ændres uden:
  - Opdatering af tests
  - Opdatering af debug-/reference-side
  - Klart dokumenteret commit

**Kontrakt-kommentar (skal stå i koden ved templaten):**

```js
// LAYOUT-LOCK: HTML-struktur og rækkefølge af kolonner i materialerækker
// må IKKE ændres uden at opdatere:
// - material-row layout tests
// - debug/material-row-debug.html
// - relevant dokumentation i AGENTS.md
````

#### Løn-fane

Layout for løn-fanen er også **låst**:

1. Sektion: Ekstra arbejde
2. Sektion: Medarbejdere
3. Knap: **Beregn løn**
4. Resultat-panel (løn-udregning)
5. Under resultat:

   * Print
   * Eksportér akkordseddel
   * ZIP (pak alt til download)
   * Visning af materialesum, lønsum og projektsum

**MUST:**

* Denne rækkefølge skal respekteres i HTML-strukturen.
* Resultatet skal altid dukke op **lige under** “Beregn løn”-knappen.

---

### 1.3 Mobil-first

* Design for **mobil** først (eksempel: 375 x 812 viewport).
* Ingen horisontal scroll.
* Knapper skal være nemme at ramme (min. ca. 40x40 px klik-område).
* Numpad og A9-overlay skal være responsive, ingen overlappende UI.

---

### 1.4 PWA og service worker

* `service-worker.js` må kun loade filer, der **faktisk findes** i repoet.
* Ingen 404 på cache-lister.
* Ved nye kritiske filer (JS, CSS, HTML) der skal virke offline:

  * Tilføj dem til cachen.
  * Bump SW-version (fx ændre cache-navn).

---

### 1.5 Akkordseddel-data (import/export-kontrakt)

Målet er at kunne:

* Eksportere en **montage**-akkordseddel.
* Importere den igen senere og bruge den som basis for **demontage**.

**Data-kontrakt (konceptuelt JSON-objekt):**

```jsonc
{
  "type": "montage" | "demontage",
  "jobId": "string",
  "jobName": "string",
  "createdAt": "ISO-8601 datetime",
  "materials": [
    {
      "id": "BOSTA_073x257",  // materiale-id som kendes af dataset.js
      "name": "Plank 0,73 x 2,57", // optional, men nice
      "qty": 42,
      "unitPrice": 12.34            // optional
    }
  ],
  "extras": {
    "km": 37,
    "tralleløft": 4,
    "huller": 3,
    "lukAfHul": 2,
    "boringBeton": 6,
    "andre": [
      // evt. future-proof
    ]
  },
  "wage": {
    "totalHours": 0,
    "workers": [
      {
        "name": "Navn",
        "hours": 37,
        "role": "Udd1|Udd2|Lærling|Mentor",
        "hourlyRate": 0
      }
    ]
  }
}
```

Eksportformat kan være JSON, CSV eller begge, men **indholdet** skal matche ovenstående logik.

---

### 1.6 Fejl- og advarselsregler

* Ingen `console.error` i normal brug.
* Ingen ubehandlede exceptions.
* Ingen 404 på nødvendige assets.
* Ingen TODO/FIXME tilbage i ændrede filer.

### 1.7 Team-adgang (UID-lås)

* Medlemsdokumenter **SKAL** gemmes som `teams/{teamId}/members/{auth.uid}` (doc.id = UID). Brug altid `doc(..., uid)` – aldrig `addDoc`/auto-ID.
* Standardteam er `hulmose` (profilens `teamId` > UI/localStorage > fallback `hulmose`).
* Admin-email (`mr.lion1995@gmail.com`) må auto-bootstrappes til default-teamet én gang pr. session, ellers brug manuel invite/membership.
* Fejlfinding: Hvis AccessDenied/“Du er ikke tilføjet…”, opret dokumentet med brugerens UID på ovenstående sti og prøv igen. Dokumentér forventet sti i konsol-log.

---

## 2. Standard-kommandoer

**Som udgangspunkt** (kan tilpasses til det faktiske `package.json`):

```bash
# Installér afhængigheder
npm install

# Unit / integration tests
npm test

# E2E-tests (Playwright/cypress el.lign.)
npm run e2e

# Lighthouse / kvalitet
npm run lh:mobile
# evt.
npm run lh:desktop
```

En ændring er **først færdig**, når relevante tests er kørt og grønne.

---

## 3. AGENTER

Her defineres de logiske “agenter” der bruges i dit workflow.
De kan repræsentere:

* Mennesker,
* ChatGPT/Codex,
* Automatiske scripts.

### 3.1 PLANNER

**Rolle:**
Oversætter brugerens idé/ønske/klage til en klar, struktureret opgave og prompt.

**Ansvar:**

1. Læs brugerens tekst + relevante filer:

   * `Sscaff mangler og fejl.txt`
   * `Sscaff fejl og mangler.pdf`
2. Uddrag:

   * Problem(er)
   * Akutte bugs
   * Feature-ønsker
3. Formuler en **Codex-prompt** med:

   * Repo-navn: `ReneLS365/Cssmate`
   * Kontekst:

     * Mobil-first
     * Ingen frameworks
     * Layout-lock
   * Klare delopgaver:

     * Hvilke filer der må/skal røres
     * Hvad der **ikke** må ændres
   * Krav til test og kvalitet

**Eksempel (PLANNER-output):**

```text
Codex: “Fix 'Vis valgte materialer' + tilføj tests (Cssmate)”

KONTEKST
- Repo: ReneLS365/Cssmate
- Problem: 'Vis valgte materialer' viser ikke alle linjer og har huller i listen.
- Layout skal bevares (4 kolonner: navn, antal, pris, linjetotal).

OPGAVE
1) Find funktionen der styrer 'Vis valgte materialer'.
2) Ret logikken:
   - Vis alle materialer med qty > 0.
   - Behold rækkefølgen fra hovedlisten.
   - Ingen tomme rækker.
3) Tilføj tests:
   - Case med 1 materialevalg.
   - Case med flere, ikke-sammenhængende linjer.
4) Kør npm test + evt. e2e.

MÅ IKKE:
- Ændre HTML-struktur for materialerækker.
- Indføre frameworks.
```

**PLANNER må ikke:**

* Åbne for “fri fantasi” i Codex-prompten.
* Undlade at nævne layout-lock / mobil-first ved UI-opgaver.

---

### 3.2 IMPLEMENTER

**Rolle:**
Laver den konkrete kode, der opfylder PLANNER’s specifikation.

**Ansvar:**

1. Følge PLANNER’s prompt **præcist**.
2. Respektere projekt-kontrakten:

   * Ingen frameworks.
   * Ingen ændring af navngivne kontrakter.
3. Skrive ren og læsbar HTML/CSS/JS.

**Kodestandarder (kort):**

* JS:

  * Brug `const`/`let`, ikke `var`.
  * Undgå globalt rod; brug moduler hvor muligt.
  * Funktioner skal være små og have et klart ansvar.
* CSS:

  * Brug eksisterende struktur og naming så vidt muligt.
  * Ingen vilde animationer eller tunge effekter.
* HTML:

  * Semantisk hvor det giver mening (`<section>`, `<header>`, `<main>`, osv.).
  * Ikke tilføje unødige wrappers.

**Eksempel på korrekt refaktor:**

```js
// Før: utydeligt filter
const selected = materials.filter((m) => m.selected);

// Efter: mere robust og klar
function isSelectedMaterial(material) {
  return Number(material.qty) > 0;
}

const selected = materials.filter(isSelectedMaterial);
```

**IMPLEMENTER må ikke:**

* Lægge TODO-kommentarer ind i stedet for færdig kode.
* Skjule fejl med `try/catch` uden at fikse root cause.

---

### 3.3 QA / TESTER

**Rolle:**
Finder fejl, mangler og halv-løsninger.
Godkender eller forkaster ændringer.

**Ansvar:**

1. Kør alle relevante scripts:

   * `npm test`
   * `npm run e2e`
   * `npm run lh:mobile` (og `lh:desktop` hvis relevant)

2. E2E-scenarier (minimum):

   * **A. Optælling + “Vis valgte materialer”**

     * Indtast antal på 3–5 materialer spredt i listen.
     * Aktivér “Vis valgte”.
     * Verificér:

       * Alle materialer med antal > 0 vises.
       * Ingen tomme rækker/huller.
       * Tallene matcher input.

   * **B. Historik sletning**

     * Opret og gem en sag.
     * Gå til Historik → tjek den er der.
     * Tryk “Slet”:

       * Bekræftelses-popup skal vises.
       * Efter OK er sagen væk og kommer ikke igen efter reload.

   * **C. Løn-flow (montage)**

     * Brug en realistisk materialesum.
     * Tilføj ekstra arbejde.
     * Tilføj 1–3 medarbejdere.
     * Tryk “Beregn løn”.
     * Tjek:

       * Rækkefølgen: Ekstra arbejde → Medarbejdere → Beregn løn → resultat → export/print/ZIP.
       * Resultatet er synligt og ser fornuftigt ud.

   * **D. Eksport / ZIP**

     * Eksportér akkordseddel.
     * Eksportér ZIP.
     * Tjek:

       * At download trigges.
       * At ZIP’en kan åbnes og indeholder mindst det forventede (fx akkordfilen).

   * **E. Import + demontage**

     * Eksportér en montage-akkordseddel.
     * Nyt session: importér filen igen.
     * Tjek:

       * Materialer og ekstra felter genskabes korrekt.
       * Type kan sættes til “demontage”.
     * Ret km/timer og eksportér en ny demontage-seddel.

   * **F. PWA-install**

     * Mock `beforeinstallprompt` i test.
     * Tjek at installer-knappen vises og kalder `prompt()`.
     * På iOS (detekter), tjek at brugeren får en tekstlig vejledning (Share → “Føj til hjemmeskærm”).

   * **G. Alfix-export**

     * Vælg Alfix-system.
     * Tæl nogle Alfix-materialer.
     * Eksportér og tjek at de er med i filen.

3. Devtools-check:

   * Åbn appen i mobil-view.
   * Gå gennem:

     * Materialefane
     * Løn-fane
     * Historik
     * Export/ZIP
   * Ingen `console.error` eller 404 må fremkomme ved “normal” brug.

**QA/TESTER må ikke:**

* Godkende ændringer med kendte fejl.
* Slå tests fra for at få grøn CI.

---

### 3.4 CLEANUP

**Rolle:**
Rydder op i repoet efter ændringer.

**Ansvar:**

1. Fjerne:

   * Ubrugte variabler og imports.
   * Temporære filer (`dir`, `mkdir`, `response`, osv. der er røget i repoet ved en fejl).
   * Døde funktioner, der aldrig kaldes.

2. Ensrette kommentarer:

   * Korte og præcise.
   * Markér “layout-lock”-zoner tydeligt.
   * Beskriv eksport-/importformatet dér hvor det defineres.

3. Git:

   * `git status` skal være clean før merge.
   * Ingen “rod-filer” i roden af repoet.

---

### 3.5 RELEASE-ORCHESTRATOR (valgfri, men anbefalet)

**Rolle:**
Sikrer at en samlet release er klar til produktion.

**Checkliste før release:**

1. **Kode**

   * Alle planlagte features er implementeret.
   * Ingen TODO/FIXME i ændrede filer.

2. **Tests**

   * `npm test` grøn.
   * `npm run e2e` grøn.
   * Lighthouse-scorer er acceptabel (gerne 1.0 på mobile kategorier, hvis der allerede er sådan et krav i CI).

3. **PWA**

   * Service worker uden fejl.
   * Ingen 404 på filer SW forsøger at cachte.

4. **Funktionalitet (hurtig sanity):**

   * Materialeliste kan scrolle og bruge numpad.
   * “Vis valgte materialer” virker.
   * Løn kan beregnes.
   * Historik kan gemme + slette sager.
   * Eksport (akkord + ZIP) virker.
   * Import + demontage-flow virker.
   * Installer-knap opfører sig korrekt.

5. **Deploy**

   * Netlify (eller anden host) viser en stabil build.
   * Ingen kritiske fejl i browser-konsollen på production-URL.

---

## 4. Sådan bruges denne fil

* **Når du laver ny opgave:**

  * Start med PLANNER-rollen.
  * Lav en klar Codex-prompt baseret på reglerne her.
* **Når du skriver kode:**

  * Tænk som IMPLEMENTER.
* **Når du tjekker om noget er klar til brug:**

  * Tænk som QA/TESTER.
* **Når repoet er blevet rodet til:**

  * Tænk som CLEANUP.
* **Når du vil frigive en version:**

  * Tænk som RELEASE-ORCHESTRATOR.

Hvis en ændring ikke opfylder kravene i denne fil, er den ikke klar til release.

```
```
