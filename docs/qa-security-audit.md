# Forest Side Resort — Production QA & Security Audit

**Assessment:** 23 November 2026  
**Scope:** Repository review, production builds, Vitest suites, Prisma schema validation, and source-level security/performance inspection. No production or staging services were contacted.

## 1. Tests performed

- Frontend production build: `npm run build`.
- Backend production build: `npm run build:api`.
- Frontend Vitest: `npm run test:web`.
- Backend Vitest: `npm run test:api`.
- Prisma schema validation: `npm run prisma:validate` with a validation-only local URL. This validates the schema; it does not connect to PostgreSQL or apply a migration.
- Source review for authentication, role checks, cookie settings, CORS and request-origin checks, input validation, SQL access, logs, public data, environment exposure, Excel parsing, booking conflicts, dashboard queries, and public URL handling.
- Checked available browser/E2E tooling. Playwright is not installed in this repository; the local preview was not reachable from the available browser session.

## 2. Passed tests and checks

- Frontend build passed. Output: JS 347.41 KB raw / 102.15 KB gzip; CSS 45.68 KB raw / 11.20 KB gzip.
- Backend TypeScript production build passed.
- Frontend Vitest: **7 passed**. Tests cover the HTTPS external-link allowlist and unsafe/malformed URL fallbacks.
- Backend Vitest: **17 passed**. Coverage includes health behavior with mocked storage, property-local date validation, request-only booking creation and reference generation, invalid dates, unauthenticated admin rejection, booking overlap logic, weather fallback/cache behavior, Excel parsing/privacy-safe preview/import, owner authorization for personal-data import, disallowed browser origins, and unsafe public map links/settings.
- Prisma schema validation passed.
- Source inspection found no `dangerouslySetInnerHTML`, `innerHTML`, or unsafe Prisma raw-query calls. Database operations use Prisma; booking lock SQL uses a parameterized tagged template.
- Admin APIs apply session authentication. Passwords use bcrypt; session tokens are random and stored hashed; the session cookie is HTTP-only, SameSite=Lax, and Secure in production. Mutating admin requests are checked against configured origins.
- Public review retrieval selects only verified, published reviews. Traveller import preview omits names, phone numbers, identity details, and addresses; personal data import requires explicit owner-level authorization.

## 3. Failed, skipped, and unverified checks

- **PostgreSQL integration test: skipped (1).** `TEST_DATABASE_URL` is not configured, so the database-level exclusion/overlap constraint was not exercised against PostgreSQL.
- **Database migration application/status: not run.** There is no configured database connection. `prisma validate` is not evidence that the migration has been applied or that a live database matches the schema.
- **Playwright end-to-end tests: not run.** Playwright is absent from the dependencies, and the browser session could not reach the local Vite preview. No full browser workflow or rendered mobile screenshot was verified.
- **Live smoke tests: not run.** There is no configured API/database environment for real HTTP flows.
- **Not directly exercised end-to-end:** login/logout cookie lifecycle, manager/staff/super-admin permission matrix, booking status changes, enquiry submission/response, guest record edits, tariff retrieval and date quotes, live weather provider behavior, WhatsApp consent/template delivery, dashboard KPI values, attraction/cafe CRUD, and Excel import rollback against a real database. Some supporting unit/API behavior is covered with mock Prisma services, but that is not a substitute for database or browser workflows.
- **Performance measurements:** no production or staging API/database was available. Network timings, Core Web Vitals, query latency, mobile device performance, and image delivery were not measured. The current site uses labeled placeholders rather than property photographs, so image optimization remains to be assessed once approved images are supplied.
- **Dependency vulnerability scan / dynamic security scan:** not performed.

## 4. Bugs fixed during the audit

- Removed the hard-coded local database username/password fallback from API configuration. Production still requires an explicit `DATABASE_URL`.
- Restricted public attraction/cafe map and photo URLs to HTTPS and disallowed URLs containing embedded credentials. Added client-side HTTPS fallback handling for stored/external links.
- Restricted website setting values to bounded text, preventing malformed object values from breaking public rendering.
- Added negative tests for unapproved admin origins, script-capable map URLs, and non-text public settings.
- Reduced dashboard query volume by deriving booking-source counts from the existing grouped query rather than fetching every qualifying booking row.

## 5. Remaining limitations and risks

- Test coverage is incomplete for the end-to-end workflows listed above. In particular, authentication lifecycle, role boundaries, admin mutations, and frontend booking/enquiry flows need browser tests and a disposable PostgreSQL database.
- The real migration must be applied and verified against a non-production PostgreSQL database before release. The database integration test should then run with `TEST_DATABASE_URL` pointing only to that disposable database.
- Add Playwright and run desktop/tablet/mobile route and workflow tests before calling the application production-ready.
- Confirm production Render values, especially `DATABASE_URL`, exact `APP_ORIGINS`, and the frontend build-time `VITE_API_BASE_URL`; no production secrets or services were inspected.
- Rate limiting currently uses the default in-process store. If the API runs multiple instances, limits are per instance; configure a shared store before relying on global abuse thresholds at scale.

## 6. Production readiness assessment

**Not approved for production release yet.** Both application builds and the available Vitest suites pass, and several security hardening changes were made. However, the PostgreSQL integration test and migration application remain unverified, Playwright/browser workflows were not run, and key admin/public journeys have not been exercised against a real disposable environment. Complete those checks before deployment.
