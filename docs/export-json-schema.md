# Export JSON schema (Stage 15)

Alle eksport-typer (JSON, PDF, CSV, ZIP) bruger samme datamodel. Felterne herunder er source of truth for akkordsedler.

## meta
- `version`: Model-version, f.eks. `2.0`.
- `caseNumber`: Sagsnummer.
- `caseName`: Sagsnavn/beskrivelse.
- `customer`: Kunde.
- `address`: Adresse.
- `date`: ISO-dato (YYYY-MM-DD).
- `system`: Primært stilladssystem.
- `jobType`: montage/demontage.
- `jobFactor`: multipliceringsfaktor for priser.
- `createdAt` / `exportedAt`: tidsstempler.

## items
Liste over materialelinjer.
- `lineNumber`, `system`, `category`, `itemNumber`, `name`, `unit`
- `quantity`, `unitPrice`, `lineTotal`

## extras
- `km`: `{ quantity, rate, amount }`
- `slaeb`: `{ percent, amount }`
- `tralle`: `{ lifts35, lifts50, amount }`
- `extraWork`: `[{ type, quantity, unit, rate, amount, description }]`

## wage
- `workers`: `[{ id, name, hours, rate, total, allowances: { mentortillaeg, udd } }]`
- `totals`: `{ hours, sum }`

## totals
- `materials`: materialesum
- `extras`: sum af km/slæb/ekstraarbejde/tralleløft
- `extrasBreakdown`: `{ km, slaeb, tralle, extraWork }`
- `akkord`: samlet akkordsum
- `project`: projektsum (fallback til akkord)
