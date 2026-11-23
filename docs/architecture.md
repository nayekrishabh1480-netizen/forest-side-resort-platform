# Backend architecture

The backend is an independently deployable Express service in `apps/api`. The existing Vite frontend remains at the repository root. The API uses TypeScript, Zod for request validation, Prisma for PostgreSQL access, bcrypt password hashing, cookie-based administrator sessions, and modular provider adapters.

```text
Browser / Admin UI
        │ HTTPS, JSON, HttpOnly session cookie
        ▼
Express /api/v1 ── Zod validation ── authorization / rate limits
        │
        ├── Booking service ── Prisma transaction + PostgreSQL exclusion constraint
        ├── Weather service ── Open-Meteo + persisted cache
        ├── Notifications ── WhatsApp Cloud API / SMTP (optional)
        └── Map links ── Google Maps search URL
                         │
                         ▼
                    PostgreSQL
```

## Boundaries and behavior

- `routes/public.ts` serves public resort content and guest-submitted requests. It never returns guest records.
- `routes/admin.ts` and `routes/imports.ts` require an authenticated administrator and enforce role rules for sensitive actions.
- `services/bookings.ts` validates property-local dates, controls state transitions, and serializes confirmed room assignments.
- `services/weather.ts`, `services/notifications.ts`, and `services/maps.ts` isolate third-party concerns and provide graceful fallback behavior.
- `prisma/schema.prisma` is the model source. SQL migration constraints add database checks and overlapping-stay protection beyond ORM validation.

## Booking lifecycle

Public booking requests remain `REQUESTED`. Only an administrator can move a request to `CONFIRMED`; the transaction verifies an active room, capacity and dates. A database exclusion constraint prevents overlapping confirmed stays for a specific room using half-open date ranges. Cancellation frees the room. Payment is recorded as a status only; no payment card data or simulated payment is accepted.

## Deployment shape

Deploy the API as a Render Web Service and PostgreSQL as a separately managed Render database; deploy the frontend as a Render Static Site. Provide `DATABASE_URL`, `APP_ORIGINS`, and optional provider credentials through the hosting environment. Run `prisma migrate deploy` as a release/pre-deploy step. Configure HTTPS and an exact production frontend origin. No hosting resources are provisioned by this repository change.
