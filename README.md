# osh26

Huvudappen för AirVenture Oshkosh 2026.

## Kartunderlag

Utställarkartan är en lagerindelad SVG med separata grupper för bas, stalls och etiketter. Den georefereras mot OpenStreetMap med en proportionell overlay: placering, enhetlig skala och rotation utan skevning.

Aktuell kalibrering finns i `config/exhibitor-map-overlay.json`.

Den komprimerade kartan finns i `public/maps/airventure-2026-exhibitor-map-layered.svg.gz`. Återskapa SVG-filen lokalt med:

```sh
gzip -dk public/maps/airventure-2026-exhibitor-map-layered.svg.gz
```

## Planerad struktur

- `config/` – kartkalibrering och appkonfiguration
- `public/maps/` – vektoriserade kartunderlag
- `src/` – huvudappens kod när implementationen startar

## Kalibreringsmodell

Overlayens centrum, omfattning och rotation sparas i geografiska koordinater. Bildens proportioner är låsta till SVG-formatet. Ingen perspektiv- eller affin skevning används i första versionen.
