# Delt sagsdepot med Algolia

Denne note beskriver den anbefalede datastruktur og frontend-konfiguration til et delt sagsdepot, hvor flere hændelser samles under samme sagsnummer.

## 1. Data-modellering og indeksering

### 1.1 Flad struktur (én post pr. hændelse)
- Gem hver hændelse som et separat objekt i Algolia. Undgå indlejrede lister af hændelser.
- Eksempel på objekt:

```json
{
  "objectID": "CASE-1234-1",
  "caseNumber": "CASE-1234",
  "address": "Søndrevej 12, 2100 København",
  "montor": ["Anna Jensen", "Lars Pedersen"],
  "comment": "Opsætning af stillads på bagsiden",
  "caseDate": "2025-09-05T09:30:00+02:00",
  "title": "Renovering Søndrevej 12",
  "status": "åben",
  "taskCount": 4,
  "lastUpdatedAt": "2025-09-10T11:15:00+02:00"
}
```

### 1.2 Aggregater per sagsnummer
- Beregn `taskCount` og `lastUpdatedAt` for alle records med samme `caseNumber`.
- Alternativt: vedligehold et separat "cases"-indeks med én post per sagsnummer (adresse, seneste dato, montører, antal hændelser).

### 1.3 Attributter til søgning og facettering
- `searchableAttributes`: `caseNumber`, `address`, `comment`, `title`, `montor`.
- `attributesForFaceting`: `caseNumber`, `address`, `montor`, `status`, `caseDate` (dato-intervaller).
- Normalisér værdier (ens stavemåde/format), så facetter ikke splittes.

### 1.4 Gruppering af sager i oversigten
- Index settings: `attributeForDistinct = "caseNumber"`, `distinct = true`.
- Klient/InstantSearch: send `distinct: 1`, evt. via `Configure`-widget.
- Viser kun den bedst rangerede hændelse pr. sagsnummer i oversigten.

### 1.5 Rangering
- `customRanking`: fx `desc(lastUpdatedAt)`, `desc(taskCount)` for at løfte nye/aktive sager.

## 2. Vedligeholdelse og batch-opdateringer
- Indsæt/opdater hændelser via API med unikke `objectID` (fx `sagsnummer-hændelsesid`).
- Opdater samtidig aggregater eller "cases"-indekset.
- Slet eller marker afsluttede sager med `status: "afsluttet"`.
- Brug batch-API til masseopdateringer.

## 3. Frontend (InstantSearch)
- Søgeboks der rammer `searchableAttributes`.
- Facet-widgets for `montor`, `status`, `caseNumber`, `address`, `caseDate`.
- `Configure`-widget med `distinct: 1` og evt. `hitsPerPage`.
- Hits-komponent viser: `caseNumber`, `address`, `lastUpdatedAt`, montører (første to + “+X flere”), `taskCount`, highlights.
- Detaljevisning: ny søgning med filter `caseNumber:<valgt>`, vis alle hændelser kronologisk. Kan kombinere med opslag i "cases"-indekset.

## 4. Ekstra overvejelser
- Normaliser `caseNumber` (uden ekstra mellemrum) og adresser; evt. ekstra felt uden skilletegn til søgning.
- Split adresse i `street`/`postalCode`/`city` hvis det gavner filtrering.
- Undgå følsomme persondata i Algolia.
- Overvej synonymer for montørnavne og adressevarianter.
- Brug dashboardet til at overvåge søgeadfærd og finjustere rangering/facetter.
