# OSH26

Huvudappen för AirVenture Oshkosh 2026.

## App

Aktuell app är mobil först, men ska fungera på desktop:

- karta med utställare och eventplatser
- crew-planering
- kalender
- platsdelning
- venue placement/reports för admin

Primär UI-kod ligger i `app/osh26-app.tsx`. Supabase email/lösenord-auth hanteras i klienten och API:erna verifierar Supabase Bearer-token.

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

Appen använder Supabase email/lösenord-auth för användaridentitet. Klienten skickar Supabase access token som Bearer-token till API:erna.

Supabase public-konfig finns i `lib/supabase-config.ts`. Publishable key och projekt-URL är publika klientvärden; lägg aldrig Supabase secret/service-role key i frontend.

Supabase-filerna i `supabase/` finns kvar från parallellspåret med RLS-tabeller. Aktuell app använder fortfarande D1 för crew-plan, kalender och platsdata.

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
