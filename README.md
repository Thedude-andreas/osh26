# OSH26

Huvudappen för AirVenture Oshkosh 2026.

## App

Aktuell app är mobil först, men ska fungera på desktop:

- karta med utställare och eventplatser
- crew-planering
- kalender
- platsdelning
- venue placement/reports för admin

Primär UI-kod ligger i `app/osh26-app.tsx`. `app/page.tsx` hämtar ChatGPT-identitet via `app/chatgpt-auth.ts` och skickar den till appen.

## Data

Statiska data ligger under `public/data/`.

- `exhibitors.json`
- `stalls.geojson`
- `booth-labels.geojson`
- `events.json`
- `event-venues.json`
- `event-venues.geojson`

Eventplatser byggs från importerade AirVenture/OSM-källor:

```sh
python3 scripts/build-event-venues.py
```

## Runtime

Appen använder Vinext/Cloudflare Sites-formen med D1 via Drizzle.

Viktiga kommandon:

```sh
npm run dev
npm run build
npm test
npm run lint
npm run db:generate
```

Lokalt krävs Node.js `>=22.13.0`.

## Auth

Den sammanslagna mobilappen använder ChatGPT/Sites identity headers:

- `oai-authenticated-user-email`
- `oai-authenticated-user-full-name`

Hjälpfunktionerna finns i `app/chatgpt-auth.ts`.

Supabase-filerna i `supabase/` finns kvar från parallellspåret med email/password-auth och RLS. De är inte primär runtime för den aktuella mobilappen om inte vi uttryckligen byter tillbaka till Supabase-auth.

## Databas

D1-schema ligger i `db/schema.ts` och migrationer i `drizzle/`.

Mobilappen använder D1-tabeller för:

- crews
- crew_members
- crew_items
- venue_placements
- venue_location_reports
- location_preferences
- location_requests
- location_samples

## Deploy

Deploy görs bara när användaren uttryckligen ber om det.
