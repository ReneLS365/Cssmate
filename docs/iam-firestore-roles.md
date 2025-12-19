# Firestore IAM-roller (SSCaff/Cssmate)

Brug prædefinerede roller for mindst mulige privilegier. Custom-roller er kun nødvendige, hvis ingen prædefineret rolle dækker dit behov.

## Kerneroller

* `roles/datastore.user` – læse/skrive adgang til Firestore-data (typisk til servicekonti/app).
* `roles/datastore.indexAdmin` – oprette/administrere indeksdefinitioner (nødvendig hvis du følger “create index”-link fra Firestore fejlbeskeder).
* `roles/datastore.viewer` – read-only (til dashboards/opsyn, ikke til appens login-flow).

Primitive roller (`Owner`, `Editor`, `Viewer`) bør ikke bruges i produktion.

## Tildel roller i Cloud Console

1. Gå til **IAM & Admin → IAM**.
2. Find brugeren **mr.lion1995@gmail.com** (admin):
   * Tilføj mindst `roles/datastore.user`.
   * Tilføj `roles/datastore.indexAdmin` hvis du vil kunne oprette manglende indekser via fejllinks.
3. For servicekonti (CI, scripts):
   * Tilføj `roles/datastore.user`.
   * Tilføj `roles/datastore.indexAdmin` hvis de skal kunne oprette indekser.

> Bemærk: Firebase Authentication-brugere styres af Firestore Security Rules og appens login-flow, ikke IAM. IAM dækker kun console-/servicekonto-adgang.

## Fejlsøgning

* **“Missing or insufficient permissions”** – tjek at kontoen har `roles/datastore.user`, at `teamId` er korrekt, og at appen er logget ind (authReady + sessionReady).
* **Manglende indeks** – kræver `roles/datastore.indexAdmin` for at åbne create-index-linket fra fejlbeskeden. Appen viser et banner (“Mangler Firestore index…”) og logger linket i konsollen.
