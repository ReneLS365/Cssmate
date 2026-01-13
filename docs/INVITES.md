# Invitationer i SSCaff

Denne guide beskriver invitationer til teamet (Model B).

## Invitér en kollega

1. Gå til **Team**-fanen.
2. Indtast kollegaens email og vælg rolle (Medlem eller Admin).
3. Klik **Invitér**.
4. Del invite-linket, hvis email ikke kan sendes direkte.

**Vigtigt:** Kollegaen skal logge ind med den email, der blev inviteret.

## Acceptér invitationen

1. Åbn invite-linket (fx `https://sscaff.netlify.app/invite?token=...`).
2. Log ind med Auth0.
3. Når invitationen er accepteret, bliver brugeren medlem af teamet.

Hvis login-email ikke matcher, vises en fejl. Log ud og log ind med den korrekte email.

## Håndter medlemmer og inviter

- **Medlemmer:** Admin kan ændre rolle eller fjerne medlemmer.
- **Pending invites:** Admin kan se aktive invitationer, tilbagekalde eller sende igen.
- **Send igen:** Genererer et nyt token og opdaterer udløbsdatoen.

## Hvis mailen ikke kommer frem

- Kopiér invite-linket fra Team-fanen og send det manuelt.
- Kontroller at `EMAIL_PROVIDER_API_KEY` og `EMAIL_FROM` er sat korrekt i Netlify.

## Troubleshooting

- **"Email matcher ikke invitationen"**: Log ind med den email, der blev inviteret.
- **"Invitationen er udløbet"**: Admin skal sende en ny invitation.
- **"Invitationen er tilbagekaldt"**: Admin skal oprette en ny invitation.
- **"Kun admin kan udføre denne handling"**: Du mangler admin-rolle i teamet.
