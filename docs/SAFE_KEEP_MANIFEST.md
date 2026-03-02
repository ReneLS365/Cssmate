# SAFE KEEP MANIFEST (Baseline freeze before Lovable port)

This document defines the safety boundary for the upcoming Lovable/scaff-inspired UI work.

## Purpose

- Freeze business-critical logic and data so later UI work cannot alter calculations, pricing, import/export contracts, auth behavior, or shared-case behavior.
- Clarify where visual refactor can happen later without changing outputs.
- Keep Cssmate as the canonical source of truth for workflows and logic.

> Lovable/scaff is a visual/UX reference only. It is **not** the source of truth for business logic, data contracts, or runtime behavior.

## A) Frozen business-critical areas (do not change in UI-port tasks)

These files/paths are frozen and must remain behavior-identical:

- `js/a9-calc.js`
- `js/akkord-export.js`
- `js/akkord-export-ui.js`
- `js/export-*.js`
- `js/import-akkord.js`
- `js/job-snapshot.js`
- `dataset.js`
- `complete_lists.json`
- `akkord/*.xlsx`
- `src/prices/**`
- `src/calc/**`
- `src/export/**`
- `src/import/**`
- `src/counting/**`
- `src/scaffold/**`
- `src/auth/**`
- `js/shared-auth.js`
- `js/shared-cases-panel.js`
- `js/shared-ledger.js`
- `netlify/functions/**`

Why frozen:

- These areas control pricing, totals, wage math, item datasets, import/export shape, shared-case persistence, auth access rules, and backend contracts.
- Any drift here can silently change real-world pay/project outcomes and break compatibility.

## B) Allowed future refactor zones (not in this task)

These areas are allowed for later visual cleanup/porting, but remain out of scope for this baseline task:

- `app-main.js`
- `index.html`
- `style.css`
- `css/**`
- `src/ui/**`
- `src/app/**`
- `src/pages/**`
- `src/state/**`

Rules for future refactor in these zones:

- Visual and UX polish only unless explicitly approved otherwise.
- Keep all existing workflows, outputs, labels, and data semantics intact.
- Preserve IDs/selectors/hooks that existing JS and tests depend on.

## C) Archive/legacy candidates (review only, no move/delete in this task)

Candidate areas for later review:

- `debug/**`
- review markdown reports in repo root/docs
- `release-artifacts/**`
- `reports/**`
- duplicate/readme noise if found

Current policy for this baseline task:

- No moving files.
- No deleting files.
- No runtime file renames.

## Non-negotiable baseline contract

- Later Lovable/scaff porting must stay visual-first and never alter business outputs.
- Cssmate remains canonical for logic, contracts, and production workflows.
- Any future risky change must be protected by regression tests before merge.
