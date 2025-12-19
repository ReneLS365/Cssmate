# Debug & login-fejlsøgning

Brug denne guide når login eller Firestore-adgang fejler. Debug-overlayet kan tændes i prod ved at sætte `localStorage.sscaffDebug = "1"` (eller automatisk i udviklingsmiljøer).

## Overlay-felter

* **AUTH**
  * `authReady` – Firebase Auth er initialiseret.
  * `uid`/`email` – nuværende bruger.
  * `providerIds` – f.eks. `google.com` eller `password`.
  * `emailVerified` – true for password-brugere efter verificering (Google er altid true).
* **TEAM**
  * `teamId` – valgt team (default: `hulmose`, gemmes i `sscaff.teamId`).
  * `teamResolved` – medlemsdokument er slået op.
  * `memberExists` – medlemsdoc fundet.
  * `memberRole` – `admin` eller `member`.
  * `memberActive` – false hvis deaktiveret.
* **SESSION**
  * `sessionReady` – alle gates er opfyldt (authReady + user + teamResolved + memberExists + memberActive !== false).
  * `sessionStatus` – rå sessionstatus (`signedIn_admin`, `signedIn_member`, `signingIn`, osv.).
  * `currentView` – aktiv fane.
* **FIRESTORE**
  * `lastFirestoreError` – sidste fejlkode/besked + sti (hvis kendt).

## Hurtig fejlsøgning

1. **authReady = false** – Firebase config mangler eller Auth er ikke initialiseret. Tjek `FIREBASE_CONFIG` i siden.
2. **user = null** – brug global login-skærm (AuthGate). Ingen login-knapper i “Delte sager”.
3. **requiresVerification/password** – password-bruger skal bekræftes; brug “Send verifikationsmail igen” + “Jeg har verificeret”.
4. **teamResolved = false** – vent på team-opslag. Standardteam er `hulmose`; check localStorage `sscaff.teamId`.
5. **memberExists = false** – du er ikke tilføjet til teamet (`teams/{teamId}/members/{uid}`). Kontakt admin.
6. **memberActive = false** – medlem deaktiveret. Kontakt admin for reaktivering.
7. **sessionReady = false & lastFirestoreError.code = permission-denied** – typisk forkert teamId eller manglende medlem/rolle i Firestore.
8. **lastFirestoreError.code = failed-precondition + “index”** – manglende Firestore-indeks. Appen viser banner “Mangler Firestore index…” og logger create-index link i konsollen (kræver `roles/datastore.indexAdmin` i IAM).

## Manuelle test-scenarier

* **Google login (admin)**: authReady=true → teamId=`hulmose` → memberExists/active=true → sessionReady=true → ingen Firestore-fejl.
* **Password login**: vis verify UI hvis email ikke er bekræftet; efter verificering klik “Jeg har verificeret” (reloader user).
* **Delte sager**: vises kun når sessionReady=true; ingen login UI i selve fanen. Fejl i Firestore vises i overlay og som inline banner.
