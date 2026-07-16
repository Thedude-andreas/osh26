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

## Supabase

Appen använder Supabase för användaridentitet och crew-data. Auth-flödet är email/password med email-verifiering, password reset och Supabase RLS.

Lokalt krävs:

```sh
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

Skapa tabeller och RLS-policies genom att köra SQL-filerna i `supabase/migrations/` i Supabase SQL Editor eller via Supabase CLI.

Använd endast publishable key i frontend. Secret/service-role key får inte byggas in i klienten.

### Supabase Auth

Konfigurera Supabase Dashboard:

- Authentication -> Sign In / Providers -> Email: aktivera Email provider
- Aktivera email/password signups
- Aktivera email confirmation
- Aktivera password recovery
- Authentication -> URL Configuration:
  - Site URL: `http://127.0.0.1:5173` lokalt, senare `https://osh26.andreasmartensson.com`
  - Redirect URLs:
    - `http://127.0.0.1:5173`
    - `http://localhost:5173`
    - `https://osh26.andreasmartensson.com`

### Custom SMTP

För produktion och för att slippa Supabase standardgräns på auth-mail ska projektet använda Custom SMTP, samma modell som VFRPlan.

Rekommenderad Resend-konfiguration:

- Sender: `OSH26 <no-reply@osh26.andreasmartensson.com>`
- SMTP host: `smtp.resend.com`
- SMTP port: `587`
- SMTP username: `resend`
- SMTP password: Resend SMTP/API secret
- Sender name: `OSH26`

Lägg in DNS-posterna som Resend ger för SPF/DKIM hos one.com innan produktion.

Emailtemplates finns i:

- `supabase/templates/confirmation.html`
- `supabase/templates/recovery.html`
