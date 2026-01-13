# Deploy til Netlify

Denne guide beskriver de nødvendige trin for deploy af Cssmate til Netlify.

## Build og deploy

1. Kør build lokalt ved behov:
   - `npm run build`
2. Push til den ønskede branch og lad Netlify bygge.
3. Verificér at deploy’et er grønt og at preview/production fungerer.

## Prerendering (ny udvidelse)

Legacy‑prerendering er slået fra. Prerendering håndteres via **Netlify Prerender‑udvidelsen**.
Følg opsætningen i `docs/PRERENDERING.md` for installation og aktivering.

## Efter deploy

- Udløs et nyt deploy, hvis env‑vars eller udvidelser er ændret.
- Verificér at appen loader uden fejl i browser‑konsollen.
