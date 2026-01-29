# Fejl-rapport (statisk analyse)

### Bundt 1 — Top risikozoner (min. 10)

1) **P0** — `src/lib/deploy-context.js:L34-L111`
   - **Hvorfor:** Client-side deploy context afgør `writesAllowed` ud fra env/hostname. Hvis env værdier er tomme/placeholder eller hostname ikke matcher prodHosts, kan preview fejlagtigt blive behandlet som production.
   - **Typisk failure mode:** Writes er tilladt i deploy-preview → delte sager kan skrives i preview eller pege mod forkert miljø.
   - **Hvad testes senere:** Verificér at preview-context altid giver `writesAllowed=false` (både lokalt og på Netlify preview) og at prod-hosts listen er korrekt.

2) **P0** — `netlify/functions/_context.mjs:L26-L71`
   - **Hvorfor:** Server-side deploy-context heuristikker (URL/DEPLOY_URL/DEPLOY_PRIME_URL) bruges til `isProd()` og preview-gating. Fejltolkning kan åbne writes i preview eller blokere prod.
   - **Typisk failure mode:** Preview behandles som production → writes og migrations køres mod prod DB.
   - **Hvad testes senere:** Simulér deploy contexts (production, deploy-preview, branch-deploy, missing envs) og bekræft `isProd()`/`getDeployContext()`.

3) **P0** — `netlify/functions/_db.mjs:L220-L236`
   - **Hvorfor:** Preview-DB-guard afhænger af `DATABASE_PROD_HOSTS`. Hvis den ikke er sat, kan preview pege på prod DB uden blokering.
   - **Typisk failure mode:** Preview deploy skriver mod prod database.
   - **Hvad testes senere:** Deploy preview med prod-host i `DATABASE_URL` og sikre 403/fejl, samt validate `DATABASE_PROD_HOSTS` i env.

4) **P1** — `netlify/functions/_db.mjs:L35-L169` + `netlify/functions/_db.mjs:L349-L368`
   - **Hvorfor:** Auto-migrations køres på request path ved `ensureDbReady()`. I preview kan `ALLOW_DB_MIGRATIONS=true` give writes og lang cold-start tid.
   - **Typisk failure mode:** Cold starts, timeouts, eller utilsigtede schema-writes i preview.
   - **Hvad testes senere:** Cold start + migrations i preview/prod med/uden `ALLOW_DB_MIGRATIONS` og verificér latency/timeout.

5) **P1** — `netlify/functions/_db.mjs:L267-L292`
   - **Hvorfor:** SSL-flag og DB URL resolution styres af env. Hvis `DATABASE_SSL`/sslmode mis-sættes, kan forbindelser fejle eller køre uden TLS i miljøer der kræver TLS.
   - **Typisk failure mode:** Database connection failures eller uventet SSL behavior.
   - **Hvad testes senere:** Verificér DB connection i prod/preview med sslmode og `DATABASE_SSL` overrides.

6) **P1** — `netlify/functions/api.mjs:L68-L78`
   - **Hvorfor:** `requireDbReady()` kører på mange endpoints og returnerer 503 hvis migrations ikke er fuldført. Risiko for nedetid ved migrations eller schema drift.
   - **Typisk failure mode:** 503 “DB_NOT_MIGRATED” ved første requests efter deploy.
   - **Hvad testes senere:** Simulér schema mismatch og observer 503, samt recovery når migrations er kørt.

7) **P0** — `netlify/functions/api.mjs:L1166-L1235`
   - **Hvorfor:** Case-write endpoints mangler eksplicit preview write-guard. Hvis `isProd()` fejler eller client-side gating bypasses, kan writes ske i preview.
   - **Typisk failure mode:** Delte sager kan oprettes/slettes fra preview deploy.
   - **Hvad testes senere:** Kald case create/update/delete i preview og bekræft server-side 403.

8) **P1** — `netlify/functions/_team-cases-guard.mjs:L1-L22`
   - **Hvorfor:** SQL-guard er regex-baseret og kun aktiv i non-prod. Det kan give false negatives/positives, og dækker ikke alle skadelige queries.
   - **Typisk failure mode:** Utilsigtede SQL patterns slipper igennem i preview eller test miljøer.
   - **Hvad testes senere:** Enhedstests for guard med kendte “bad” queries og acceptable queries.

9) **P1** — `js/shared-ledger.js:L82-L105`
   - **Hvorfor:** Client-side `ensureWritesAllowed()` kan afvige fra server deploy-context. Hvis client tror prod men server ikke, opstår mismatch.
   - **Typisk failure mode:** UI tillader write, server returnerer 403 → brugere ser fejl eller kan skrive i forkert miljø.
   - **Hvad testes senere:** Cross-check client/server context på preview + production og verificér identisk write gating.

10) **P2** — `js/shared-cases-panel.js:L1687-L1764`
    - **Hvorfor:** Delta polling ignorerer errors i `.catch(() => {})` og opdaterer status kun indirekte. Risiko for silent failure/stale UI.
    - **Typisk failure mode:** Delt sager stopper med at opdatere uden tydelig fejl i UI.
    - **Hvad testes senere:** Simulér netværksfejl og verificér brugerfeedback + recovery når forbindelsen gendannes.

11) **P1** — `service-worker.js:L12-L89` + `service-worker.js:L120-L137`
    - **Hvorfor:** Lang precache-liste og aggressive cache-keys betyder at manglende filer eller stale assets kan give offline-brud og 404 cache.
    - **Typisk failure mode:** Offline mode viser gamle filer eller fejler ved manglende precache assets.
    - **Hvad testes senere:** Offline smoke-test efter deploy + validate at alle precache paths findes.

12) **P1** — `netlify/functions/_auth.mjs:L27-L75`
    - **Hvorfor:** Auth0 issuer/audience mismatch giver 401/403 og kan blokere alle endpoints. JWKS er cached globalt og afhænger af korrekt domain.
    - **Typisk failure mode:** “auth_invalid_claims”/“auth_config” fejl for alle authenticated requests.
    - **Hvad testes senere:** Verify Auth0 env vars + token validation med korrekt issuer/audience.

13) **P2** — `netlify/functions/team-cases-purge.mjs:L125-L132`
    - **Hvorfor:** Purge endpoint afhænger af `isProd()` for write lock. Hvis deploy context fejlklassificeres, kan purge blive utilgængelig eller åbnet i preview.
    - **Typisk failure mode:** Purge bliver blokeret i prod eller tilladt i preview.
    - **Hvad testes senere:** Simulér deploy-contexts og bekræft at purge kun tillades i production.

---

## Bundt 1 — Kørte kommandoer og status

- `npm install` (kørt med Node v20; repo forventer Node 22. EBADENGINE warnings observeret.)
- `rg -n "TODO|FIXME|HACK|TEMP|DEPRECATED" -S`
- `rg -n "delt sager|shared cases|shared-cases|team|members|membership" -S`
- `rg -n "await |Promise\\.all|AbortController|unhandled|catch\\(|finally\\(" -S src netlify js`
- `rg -n "localStorage|indexedDB|caches\\.|serviceWorker|CACHE_VERSION|precache" -S`
- `rg -n "VITE_NETLIFY_CONTEXT|deploy-context|writesAllowed|isProd\\(" -S src netlify js`
- `rg -n "ensureMigrations|ensureDbReady|requireDbReady|getPoolRaw|new Pool\\(" -S netlify/functions`
- `rg -n "organization|roles|claims|audience|issuer|jwtVerify|Auth0" -S src netlify/functions js`
- `node tools/repo-scan.mjs`
- `npx depcheck` (exit code 255; rapporterede expected false positives i vendor-filer)

## Bundt 1 — Begrænsninger

- Node-version i miljøet er v20, mens repo forventer Node 22 (EBADENGINE warnings under install).

## Bundt 2 — Debug-mode (runtime instrumentation)

### Aktiver debug
- URL: `?debug=1`
- localStorage: `localStorage.setItem('cssmate_debug', '1')`
- ENV: `VITE_DEBUG=1`

### Forventede logs
- Fetch timings fra API wrapper (`src/api/client.js`)
- Shared cases: fetch counts + grouping/counts + filter/sort ændringer
- (Hvis SW controller findes) cache hit/miss logs fra service worker

### Slå debug fra igen
- Fjern query-param eller kør: `localStorage.removeItem('cssmate_debug')`

## Bundt 3 — P0: delt sager stale state + publish-sync + auth edgecases

### P0-1: Export event kunne springe refresh over
- **Repro (lokal forventning):** Eksport/publish → gå til Delt sager → sagen vises straks.
- **Observed issue:** Export-event payload kan mangle `detail.case`, så refresh aldrig trigges.
- **Root cause:** Event handler i `js/shared-cases-panel.js` krævede `detail.case` før refresh. (se `handleExportedEvent`-området)
- **Fix:** Event handler refresher altid når `caseId` findes, og opdaterer UI hvis case-data findes.
- **Filer:** `js/shared-cases-panel.js` (export handler + refresh flow)
- **Test:** Ny test for export event → refresh kald.

### P0-2: Stale status/counts pga. persistente `__syncing` / `__viewBucket`
- **Repro (lokal forventning):** Efter publish/status-update skal sager skifte status korrekt uden “0” glitch.
- **Observed issue:** Merge af server-data beholdt gamle felter fra optimistic state.
- **Root cause:** `mergeEntries` og `updateCaseEntry` beholdt `__syncing`/`__viewBucket` når server-data ikke indeholdt felterne.
- **Fix:** Normalize merge så transient flags fjernes når server-data ikke eksplicit sætter dem.
- **Filer:** `js/shared-cases-panel.js` (merge/update)
- **Test:** Ny counts-test for korrekt bucket count.

### P0-3: Auth/membership transitions efterlod stale cases
- **Repro (lokal forventning):** Logout/login eller team-skift skal nulstille delt-sager state.
- **Observed issue:** Case-cache blev ikke nulstillet ved SIGNED_OUT/NO_ACCESS eller team-skift.
- **Root cause:** `bindSessionControls` resetter ikke `caseItems`/pagination på auth transitions.
- **Fix:** Reset case-state ved SIGNED_OUT/NO_ACCESS/ERROR + team-skift.
- **Filer:** `js/shared-cases-panel.js` (session change)
- **Test:** Dækkes via refresh/publish tests + manuel check (se test-matrix).
