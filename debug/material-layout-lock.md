# Materialeliste-layout (Optælling)

> Denne fil er kun reference til fremtidige PRs. Optælling-layoutet må **ikke** ændres via HTML/CSS-struktur.
> Eventuelle fejl skal løses med data/JS uden at ændre kolonneopbygningen eller tilføje søgefelter.

Nuværende markup for en materialerække (fire felter på én linje):

```html
<div class="material-row mat-row csm-row" data-item-id="ID">
  <input class="csm-name mat-name material-name" type="text" placeholder="Materiale" aria-label="Materialenavn">
  <input class="csm-qty qty mat-qty material-qty" type="number" placeholder="0" aria-label="Antal">
  <input class="csm-price price mat-price material-price" type="number" placeholder="Enhedspris" aria-label="Enhedspris">
  <div class="csm-sum mat-line mat-sum material-total" data-sum aria-label="Linjetotal">0,00 kr</div>
</div>
```

Der findes ingen "SØG I MATERIALER"-sektion i Optælling, og hver række skal blive på én vandret linje med præcis fire kolonner: navn, antal, pris, linjetotal.
