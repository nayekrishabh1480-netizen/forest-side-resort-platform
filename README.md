# Forest Side Resort

Digital hospitality platform for Forest Side Resort in Guptkashi, Uttarakhand. This is a monorepo: the React/Vite frontend is at the repository root and the Node/Express API is in `apps/api/`.

## Local setup

Copy `.env.example` to `.env` and set `DATABASE_URL` to a local PostgreSQL database. From the repository root:

```powershell
npm ci
npm run prisma:generate
npm run prisma:deploy
npm run dev:api
```

In a second terminal, run the frontend:

```powershell
npm run dev
```

The default frontend API URL is `http://localhost:4000/api/v1`. Public data and authenticated admin pages require a reachable database. Do not use the synthetic seed in production.

### Weather and WhatsApp configuration

- Set `WEATHER_API_KEY` on the backend to the OpenWeather API key. The key stays on the server. `WEATHER_LOCATION_NAME=Guptkashi` uses OpenWeather geocoding unless both owner-approved `WEATHER_LATITUDE` and `WEATHER_LONGITUDE` are supplied.
- Set `VITE_CONTACT_NO` on the Render Static Site to the resort's 10-digit Indian mobile number (digits only is preferred). It is public by design and Vite embeds it in the website build. Save the variable and trigger a new deploy so WhatsApp links appear.
- Click-to-chat uses `https://wa.me/91...`; automated WhatsApp messages remain separate and use the backend Business API credentials and guest consent.
- Public weather endpoints are `/api/v1/weather/current`, `/api/v1/weather/forecast`, and `/api/v1/weather/summary` (also `/api/v1/weather` for the full summary). OpenWeather failures never fall back to fabricated values; cached provider data is labelled stale when used.

## Production checks

```sh
npm run build
npm run build:api
npm run test:web
npm run test:api
npm run prisma:validate
```

GitHub Actions runs builds and available Vitest checks on `main` and pull requests. The PostgreSQL integration test requires a disposable `TEST_DATABASE_URL` and already-applied migrations.

## Routes

Public pages: `/`, `/about`, `/rooms`, `/book`, `/weather`, `/pricing`, `/attractions`, `/hospitality`, `/gallery`, `/contact`.

Admin pages require a server session. Public pages retrieve content from the API. Booking submissions remain requests until an administrator confirms availability. Weather, tariffs, room inventory, local listings, and verified reviews show empty or unavailable states when the owner has not configured records.

## Project documentation

- [API reference](docs/api.md) and [OpenAPI description](docs/openapi.yaml)
- [Architecture](docs/architecture.md) and [database guide](docs/database.md)
- [Deployment, environment, domain, backup, and recovery guide](docs/deployment.md)
- [Production QA and security assessment](docs/qa-security-audit.md)

Property imagery uses clearly labeled placeholders until owner-approved photographs are supplied. The traveller workbook and project PDF are excluded from version control.
