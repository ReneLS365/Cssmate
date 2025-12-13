# Historik-fanen – manuel testtjekliste

_Status: ikke udført i denne automatiske kørsel. Følgende trin skal køres manuelt på enheden._

1. Opret sag med sagsnummer 123 og eksportér akkordsedlen. Bekræft at historikken viser 1 entry.
2. Eksportér igen med samme sagsnummer men opdateret navn/adresse. Bekræft stadig én post med opdaterede data og nyere dato.
3. Eksportér sag uden sagsnummer to gange. Bekræft at fallback-nøglen undgår dubletter og opdaterer posten.
4. Brug søgning til at finde sag via adresse, navn, sagsnummer, montør og kunde.
5. Kontroller timeløn pr. montør: vises pr. montør når data findes; ellers “—” og note i detaljer.
6. Rul gennem 100+ historikposter og brug “Vis flere” uden lag på mobil.
7. Simulér refresh/reboot og bekræft at historikken bevares, og at nye entries kun oprettes ved eksportknappen.
