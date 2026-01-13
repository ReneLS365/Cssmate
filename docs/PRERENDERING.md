# Netlify Prerender‑udvidelse

Prerendering sikrer, at søgemaskiner, AI‑bots og preview‑services kan indeksere og vise appens indhold korrekt, selv om appen er en client‑side PWA.

Legacy‑prerendering i Netlify er udfaset. Fremover skal vi bruge **Netlify Prerender‑udvidelsen**.

## Opsætning (trin for trin)

1. **Deaktivér legacy‑prerendering** i Netlify:
   - Project configuration → Build & deploy → Post processing → Prerendering.
2. **Installér Prerender‑udvidelsen** på team‑niveau via Netlify Extensions‑biblioteket.
3. **Aktivér udvidelsen** for det specifikke projekt:
   - Projektmenu → Extensions → vælg Prerender → klik **Enable**.
4. **Gem ændringer og udløs et nyt deploy** (manual deploy eller trigger fra Git).

## Noter

- Udvidelsen bruger Edge‑ og serverless‑funktioner og kræver i de fleste tilfælde ingen ekstra konfiguration.
- Prerendering håndteres udelukkende i Netlify – der er **ingen** nødvendige kodeændringer i repoet.
