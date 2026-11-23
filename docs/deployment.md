# Production deployment guide

## Current deployment status

The application is a monorepo: the Vite/React frontend is at the repository root (`src/`, `index.html`, `vite.config.ts`) and the Express API is in `apps/api/`. There are no separate `frontend/` and `backend/` folders. A Render Blueprint is provided at [render.yaml](../render.yaml) for a free staging environment; it does not define production resources.

The production QA assessment is **not approved for release** until PostgreSQL integration and browser workflows are completed. Do not connect automatic production deployment or run production migrations until those checks pass. Current verified builds/tests and limitations are in [the QA report](qa-security-audit.md).

The staging Blueprint uses free Render services, disables automatic deploys, and uses only synthetic records. Free Render Postgres is temporary and expires after 30 days, so this environment is for QA and must not hold real guest data. The staging API runs Prisma migrations at startup because Render pre-deploy commands are unavailable on free web services. Production should use a paid plan with a pre-deploy migration command, backups, and the owner-approved environment values.

## Render resources

Create the frontend as a Render Static Site and the API as a Render Web Service. Keep the API and PostgreSQL database in the same Render region. The repository root must be available to both services because the API is an npm workspace and shares the root `package-lock.json`.

### Static Site

- Root Directory: repository root (`.`)
- Build Command: `npm ci && npm run build`
- Publish Directory: `dist`
- Build-time variable: `VITE_API_BASE_URL=https://<api-host>/api/v1`
- Add an SPA rewrite from `/*` to `/index.html` so React Router routes work when loaded directly.
- Add the chosen frontend custom domain in Render before setting the API CORS allowlist.

### API Web Service

- Root Directory: repository root (`.`)
- Runtime: Node
- Build Command: `npm ci && npm run prisma:generate && npm run build:api`
- Pre-deploy Command: `npm run prisma:deploy`
- Start Command: `npm run start -w @forest-side/api`
- Health Check Path: `/api/v1/health`
- Set `NODE_ENV=production`.
- Render supplies `PORT`; the API listens on `0.0.0.0` and `process.env.PORT`.

Choose the service plans and resulting cost in Render before creating resources. The deployment configuration has not been applied and no billable resources have been created from this workspace.

### PostgreSQL

- Create a managed Render PostgreSQL database in the API service's region.
- Set the API's `DATABASE_URL` from the database's **internal** connection string.
- Do not run `prisma migrate dev` against production. The API pre-deploy command uses `prisma migrate deploy`.
- Apply migrations first to a separate staging/test database, run the PostgreSQL overlap-constraint integration test, and verify restore from backup before production use.

## Environment variables

Set these in Render's service environment settings. Do not commit their values.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Internal Render PostgreSQL connection string |
| `NODE_ENV` | Yes | Set to `production` |
| `APP_ORIGINS` | Yes | Exact frontend origin(s), comma-separated, such as `https://www.example.com`; no path or trailing slash |
| `SESSION_TTL_HOURS` | Recommended | Session lifetime; defaults to 12 |
| `WEATHER_API_KEY` | Recommended | OpenWeather key; required for live current conditions and forecast |
| `WEATHER_LOCATION_NAME` | Recommended | Defaults to Guptkashi; resolved with OpenWeather geocoding |
| `WEATHER_LATITUDE`, `WEATHER_LONGITUDE` | Optional | Set together only when the owner supplies approved resort coordinates; otherwise the API geocodes the location name |
| `WEATHER_CACHE_TTL_SECONDS` | Recommended | Defaults to 900 |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, `OWNER_NOTIFICATION_EMAIL` | Optional | Email notifications; configure only after SMTP is approved and available |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION`, `WHATSAPP_TEMPLATE_BOOKING_ACK`, `WHATSAPP_TEMPLATE_BOOKING_STATUS`, `WHATSAPP_TEMPLATE_PREARRIVAL` | Optional | WhatsApp Business Cloud API; use approved templates and guest opt-in |

For the frontend, `VITE_API_BASE_URL` is public build-time configuration and accepts the API origin or a full base URL. The frontend adds `/api/v1` when it is missing. Set `VITE_CONTACT_NO` on the Render Static Site to the resort's 10-digit Indian WhatsApp number. It is public by design; it is compiled into the website and needs a rebuild after changes. Never place secrets in any `VITE_` variable.

This codebase does **not** use `FRONTEND_URL` or `SESSION_SECRET`: CORS uses `APP_ORIGINS`; administrator sessions use random tokens stored hashed in PostgreSQL.

Create the first administrator through the documented `npm run admin:create` script using a one-time secure environment session. Do not put `ADMIN_PASSWORD` into the static site, source control, or a permanent shared environment group; remove the bootstrap value after creating the account.

## Domains, HTTPS, and CORS

1. Add the frontend domain in Render and configure the DNS records Render displays for that domain.
2. Wait for Render's domain verification and managed HTTPS certificate.
3. Add the API custom domain if desired; otherwise use its Render-provided HTTPS hostname.
4. Set `VITE_API_BASE_URL` to the API's HTTPS origin plus `/api/v1`, then rebuild the static site.
5. Set `APP_ORIGINS` to the exact HTTPS frontend origin(s), then redeploy the API.
6. Verify both health endpoints and the browser's cross-origin API requests.

Never add a wildcard origin when credentialed cookies are enabled. Admin authentication cookies are HTTP-only and Secure in production.

## Deployment workflow

1. Merge reviewed, passing changes to `main` after the production QA gate is met.
2. Confirm the Render service root/build/start settings and production environment values.
3. Confirm the database backup and rollback plan. Review the migration SQL and run it against staging first.
4. Deploy the API; the pre-deploy migration runs before the new version starts.
5. Deploy the frontend with the correct `VITE_API_BASE_URL` and SPA rewrite.
6. Run the post-deployment checklist below. Keep automatic deploys disabled until these release checks are established.

## Post-deployment validation

- Open the homepage and every public route directly, including a page refresh on nested routes.
- Check responsive navigation and forms at mobile and desktop sizes.
- Verify `/health` and `/api/v1/health`, database connectivity, and persisted data.
- Submit a synthetic booking request and enquiry; verify request references and non-confirmed status.
- Verify admin login/logout and role boundaries, booking status transitions, and tariff management.
- Verify weather source/fallback behavior and WhatsApp opt-in behavior if providers are configured.
- Confirm no guest data, environment values, or credentials appear in public responses, source maps, or logs.

## Backups and recovery

- Enable Render PostgreSQL backups/snapshots appropriate to the chosen plan and retention needs.
- For an independent backup, use `pg_dump` over TLS and encrypt the dump before transfer or storage.
- Test restores into a separate database. A backup is not considered verified until the restore and core-record checks succeed.
- To recover, create a separate database, restore the selected backup, deploy the matching application version, and validate records before switching the service connection.
- Restrict production database and log access; never include guest contact details or credentials in support bundles.
