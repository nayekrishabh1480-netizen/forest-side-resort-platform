# Forest Side Resort API

Node.js, Express, TypeScript and Prisma service for the Forest Side Resort platform. The API is mounted under `/api/v1`; it stores dates in PostgreSQL and applies property calendar rules in `Asia/Kolkata`.

## Local setup

1. Install the repository dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to a PostgreSQL database.
3. Run `npm run prisma:generate`, then `npm run prisma:deploy` (or `npm run prisma:migrate` for local schema development).
4. Create the first administrator with `ADMIN_EMAIL` and `ADMIN_PASSWORD` supplied temporarily in the process environment, then run `npm run admin:create`.
5. Start the API with `npm run dev:api` from the repository root.

The service listens on `0.0.0.0` and uses `PORT`. Never use the synthetic seed for production. To create clearly labelled sample records locally, set `SEED_SYNTHETIC=true` and run `npm run prisma:seed`.

## Security and operations

- Admin sessions use opaque, hashed server-side tokens in secure, HTTP-only cookies. Configure exact browser origins in `APP_ORIGINS`.
- Public booking submissions create `REQUESTED` records. An administrator must confirm the booking after reviewing room inventory.
- Confirmed room stays are protected by a transaction lock and a PostgreSQL exclusion constraint.
- Traveller-register import is administrator-only. Import previews omit names, phone numbers, identity details and addresses. Contact data is excluded unless the SUPER_ADMIN explicitly attests to owner authorization.
- Weather is sourced from Open-Meteo and cached. On provider failure, an expired cached reading is marked stale; without cache the API returns an unavailable state.
- WhatsApp and SMTP are optional. WhatsApp messages require an approved template and recorded guest opt-in; missing provider settings leave click-to-WhatsApp as the frontend fallback.
- Configure `OWNER_NOTIFICATION_EMAIL` plus SMTP settings to email booking requests to the owner. Configure guest email to send the request acknowledgement and confirmation/decline update. Notification attempts and provider outcomes are recorded without logging message contents.
- Logs include request metadata only; customer form values and credentials are not logged.

See [API reference](../../docs/api.md), [database guide](../../docs/database.md), [architecture](../../docs/architecture.md), [OpenAPI description](../../docs/openapi.yaml), and [deployment guide](../../docs/deployment.md).
