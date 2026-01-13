# Debug & login-fejlsøgning

Brug denne guide når login eller adgang til teammedlemskab fejler. Debug-overlayet kan tændes i prod ved at sætte `localStorage.sscaffDebug = "1"` (eller automatisk i udviklingsmiljøer).

## Overlay-felter

* **AUTH**
  * `authReady` – Auth0 er initialiseret.
  * `uid`/`email` – nuværende bruger.
  * `providerIds` – hvilke providers Auth0 rapporterer.
  * `emailVerified` – true hvis Auth0-brugeren er verificeret.
* **TEAM**
  * `teamId` – valgt team (default: `hulmose`, gemmes i `sscaff.teamId`).
  * `teamResolved` – medlemsdokument er slået op.
  * `memberExists` – medlemsdoc fundet.
  * `memberRole` – `admin` eller `member`.
  * `memberActive` – false hvis deaktiveret.
  * `membershipStatus` – `loading` / `member` / `not_member` / `error`.
  * `memberPath` – forventet sti (`teams/{teamId}/members/{uid}`) der slås op.
* **SESSION**
  * `sessionReady` – alle gates er opfyldt (authReady + user + teamResolved + memberExists + memberActive !== false).
  * `sessionStatus` – rå sessionstatus (`signedIn_admin`, `signedIn_member`, `signingIn`, osv.).
  * `currentView` – aktiv fane.
## Hurtig fejlsøgning

1. **authReady = false** – Auth0 config mangler eller Auth er ikke initialiseret. Tjek at `VITE_AUTH0_*` env vars er sat og at auth-diagnostik viser domain/client-id.
2. **user = null** – brug global login-skærm (AuthGate). Ingen login-knapper i “Delte sager”.
3. **requiresVerification** – brugeren mangler verificering; brug “Jeg har verificeret” efter at have bekræftet e-mailen.
4. **teamResolved = false** – vent på team-opslag. Standardteam er `hulmose`; check localStorage `sscaff.teamId`.
5. **memberExists = false / membershipStatus = not_member** – AccessDenied vises i appen. Opret dokumentet `teams/{teamId}/members/{uid}` (doc.id = UID) med `role` og `active:true`, og prøv igen.
6. **memberActive = false** – medlem deaktiveret. Kontakt admin for reaktivering.
7. **sessionReady = false** – typisk forkert teamId eller manglende medlem/rolle i teamet.

## Manuelle test-scenarier

* **Login (admin)**: authReady=true → teamId=`hulmose` → memberExists/active=true → sessionReady=true.
* **Login (kræver verificering)**: vis verify UI hvis email ikke er bekræftet; efter verificering klik “Jeg har verificeret” (reloader user).
* **Delte sager**: vises kun når sessionReady=true; ingen login UI i selve fanen. Fejl i adgang vises i overlay og som inline banner.
