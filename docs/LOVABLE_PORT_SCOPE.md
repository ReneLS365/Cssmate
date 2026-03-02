# LOVABLE PORT SCOPE (Planning-only)

This file defines what can later be visually ported from Lovable/scaff into Cssmate.

> Lovable/scaff is a **UI reference only**.
> Cssmate remains the canonical source of truth for logic, workflow, calculations, import/export contracts, and shared/auth behavior.

## Global constraints for all sections

- Preserve behavior and output parity.
- Preserve element IDs, `data-*` attributes, and selectors used by JS/tests.
- Do not change tab meaning, label semantics, workflow sequence, or auth gating behavior unless explicitly approved.
- Keep mobile-first ergonomics and avoid horizontal scrolling.

## Header / topbar

- Current Cssmate targets: `index.html`, `style.css`, `css/**`, `src/ui/**`.
- Port type: visual-only (safe if hooks are preserved).
- Must remain identical: app startup actions, install/auth controls, existing events and bindings.
- Hook-preservation notes: keep existing button IDs/classes and load order dependencies.

## Tabs / navigation

- Current Cssmate targets: `index.html`, `app-main.js`, `src/app/**`, `src/pages/**`.
- Port type: risky (navigation wiring is behavior-critical).
- Must remain identical: tab set, labels, route/query handling, active-panel behavior.
- Hook-preservation notes: keep tab IDs, `role="tab"`, `data-tab-id`, `aria-controls`, and panel IDs.

## Cards / containers

- Current Cssmate targets: `style.css`, `css/**`, markup containers in `index.html` / `src/ui/**`.
- Port type: visual-only.
- Must remain identical: content grouping and execution order (especially around calculation/export actions).
- Hook-preservation notes: do not remove parent containers used for delegated events.

## Buttons

- Current Cssmate targets: `index.html`, `src/ui/**`, `style.css`.
- Port type: visual-only unless handlers are touched (then risky).
- Must remain identical: click handlers, disabled/enable timing, export/print triggers.
- Hook-preservation notes: keep IDs and `data-action` attributes unchanged.

## Inputs / forms

- Current Cssmate targets: `index.html`, `src/ui/**`, `src/pages/**`, `style.css`.
- Port type: risky (inputs drive logic indirectly).
- Must remain identical: field names, value parsing semantics, validation triggers, custom numpad hooks.
- Hook-preservation notes: keep input IDs/name attributes and binding selectors stable.

## Tables / lists

- Current Cssmate targets: material/list markup in `index.html`, styles in `style.css`/`css/**`.
- Port type: risky.
- Must remain identical: row ordering, data binding, and all list update semantics.
- Hook-preservation notes: preserve `.material-row` structure and child selectors required by runtime/tests.

## Mobile spacing / responsiveness

- Current Cssmate targets: `style.css`, `css/**`.
- Port type: visual-only.
- Must remain identical: tap targets, no horizontal overflow, no blocked overlays, scroll behavior.
- Hook-preservation notes: do not hide interactive controls used by keyboard/numpad/test flows.

## Status / feedback / disabled states

- Current Cssmate targets: `index.html`, `src/ui/**`, `src/state/**`, `style.css`.
- Port type: medium risk.
- Must remain identical: when actions are blocked, when loading indicators appear, and error state behavior.
- Hook-preservation notes: keep status region IDs/classes referenced in tests.

## Løn tab

- Current Cssmate targets: `index.html`, `app-main.js`, `src/pages/**`.
- Port type: high risk for layout-order regressions.
- Must remain identical: section order and result placement under “Beregn løn”; no calculation changes.
- Hook-preservation notes: preserve existing section IDs and action button selectors.

## Sagsinfo tab

- Current Cssmate targets: `index.html`, `src/pages/**`, `src/state/**`.
- Port type: medium risk.
- Must remain identical: save/update semantics and field-level behavior.
- Hook-preservation notes: preserve current form element IDs and persistence hooks.

## Optælling tab

- Current Cssmate targets: `index.html`, `src/pages/**`, `src/ui/**`.
- Port type: high risk.
- Must remain identical: material rows, qty input behavior, selected-material filtering behavior, and totals coupling.
- Hook-preservation notes: keep material row selectors and numpad entry hooks intact.

## Historik / shared cases / team areas

- Current Cssmate targets: `index.html`, `src/pages/**`, `src/state/**`, `src/auth/**`, `js/shared-auth.js`, `js/shared-cases-panel.js`.
- Port type: high risk.
- Must remain identical: access gating, shared-case state transitions, team/member behavior, and permissions expectations.
- Hook-preservation notes: preserve existing IDs, dataset flags, and status/error UI anchors used in tests.
