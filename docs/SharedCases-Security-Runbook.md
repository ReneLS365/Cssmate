# Shared Cases – Security & Operations Runbook

Denne runbook beskriver, hvordan "Delt sager" drives sikkert med privat adgang, lang tids retention og backup/restore.

## Adgang & roller
- **Login:** Konfigurer Firebase Auth med multi-provider (Google og Microsoft som minimum, evt. Apple/Facebook). Udsæt runtime-konfiguration via `window.FIREBASE_CONFIG = { apiKey, authDomain, projectId, appId }` og eventuelt `window.FIREBASE_AUTH_PROVIDERS = ['google','microsoft','apple']`. Brugerne logger ind via “Log ind med Google/Microsoft”-knapperne i UI, og navnet/e-mail vises i statusfeltet.
- **Default team:** Hvis intet andet er angivet, bruges team `Hulmose`. Sæt `window.TEAM_ID` eller brug feltet i UI for at skifte.
- **Roller:**
  - `member`: kan læse/opdatere egne sager.
  - `admin`: kan skifte status på alle sager, soft-delete/restore og køre backup/import. Admins identificeres via `user.role === 'admin'` eller en e-mail i `window.SHARED_ADMIN_EMAILS`.
- **UI-krav:** Uden login vises “Log ind for at se delte sager”, og data blokeres.

## Datamodel
- **Case**
  - `caseId` (uuid), `jobNumber`, `caseKind`, `system`, `totals`, `status`
  - `createdAt`, `updatedAt`, `lastUpdatedAt`
  - `createdBy`, `createdByEmail`, `createdByName`, `updatedBy`
  - `attachments.json` (eksport payload), `attachments.pdf` (placeholder)
  - `deletedAt`, `deletedBy` (soft delete – må ikke hard-deletes før mindst 5 år)
- **Audit** (append-only)
  - `eventId` (`_id`), `caseId`, `action` (`CREATE|STATUS|DELETE|RESTORE|RESTORE_CONFLICT`),
  - `actor`, `actorEmail`, `actorName`, `providerId`, `timestamp`, `summary`

## Retention (5 år)
- Ingen auto-slet før mindst 5 år. Soft delete markerer `deletedAt`/`deletedBy` men beholder data.
- Backup-eksporten indeholder fuld historik, så gendannelse efter 5 år er mulig.

## Backup & restore
- **Eksport:** Admin klikker “Eksporter backup”. Systemet genererer JSON med `schemaVersion: 1`, `teamId`, `exportedAt`, `retentionYears: 5`, alle `cases` (inkl. soft-deleted) og `audit` events.
- **Import:** Admin vælger backup-fil. `schemaVersion` valideres. Merge-regel: seneste `updatedAt/lastUpdatedAt` vinder, ældre konflikter logges som `RESTORE_CONFLICT` i audit.
- **Gendannelse:** Soft-deleted sager gendannes med `RESTORE` audit event. Ingen hard delete uden manuel godkendelse udenfor appen.

## Multi-provider opsætning
1. Opret Firebase-projekt og aktivér Auth.
2. Slå Google- og Microsoft-udbydere til (Apple/Facebook kan aktiveres efter behov) og kontrollér at popup eller redirect er tilladt.
3. Indsæt `window.FIREBASE_CONFIG` i HTML (eller via build-opsætning) med `apiKey`, `authDomain`, `projectId` og `appId`. Justér valgfrit `window.FIREBASE_AUTH_PROVIDERS` for at styre hvilke knapper der vises.
4. (Valgfrit) Tilføj admin-e-mails i `window.SHARED_ADMIN_EMAILS = ['leder@example.com']`.

## Drift & fejlhåndtering
- **Offline:** Fireproof fungerer som lokal cache; connection-status vises. Brugeren kan stadig se lokale data, men sync kræver online og login.
- **Audit:** Append-only; members kan ikke ændre audit. Ved fejl i audit-log skrives advarsel i konsollen, men funktionalitet fortsætter.
- **Mistede credentials:** Tilføj ny identity-provider eller genskab brugeren i auth-systemet; data knyttet til tidligere `uid` bevares i audit/backups.

## Changelog (task)
- Tilføjet auth-gate til “Delt sager” og admin-styrede backup/import.
- Soft delete, audit events og merge-logik ved restore.
- Dokumenteret 5-års retention og multi-provider opsætning.

## Manuel test (sanity)
1. Uden login: Åbn “Delt sager” → se login-krav, ingen data vises.
2. Login som member: se sager, skift status på egne sager, prøv soft delete (ingen hard delete).
3. Login som admin: kør “Eksporter backup”, importer filen igen, bekræft at data stadig vises. Konflikter skal give `RESTORE_CONFLICT` i audit.
