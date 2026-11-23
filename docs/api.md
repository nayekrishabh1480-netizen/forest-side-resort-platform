# REST API reference

Base path: `/api/v1`. JSON requests use `Content-Type: application/json`, except workbook uploads, which use multipart form data. Admin routes require the `fsr_admin_session` HttpOnly cookie. Error responses use `{ "error": { "code", "message" } }`; successful responses generally wrap output in `{ "data": ... }`.

## Public routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` and `/api/v1/health` | Process/database health |
| GET | `/resort` | Public resort settings and contact content |
| GET | `/rooms` | Active room types and amenities |
| GET | `/tariffs` | Currently effective public tariffs |
| GET | `/price-history` | Published historical rates |
| POST | `/price-quote` | Date-based indicative tariff quote |
| POST | `/availability` | Availability enquiry; does not reserve inventory |
| POST | `/booking-requests` | Creates a `REQUESTED` booking request |
| POST | `/enquiries` | Guest enquiry |
| GET | `/weather` | Current weather/cache and forecast |
| GET | `/attractions` | Published local attractions |
| GET | `/cafes` | Published cafes and restaurants |
| GET | `/meals` | Available meal options |
| POST | `/meal-preferences` | Save guest meal/pre-arrival preferences |
| GET | `/contact` | Published contact details |
| GET | `/map-link` | General location search link |
| GET | `/reviews` | Verified, published reviews only |

## Authentication and administrator routes

| Method | Path | Purpose |
|---|---|---|
| POST | `/admin/auth/login` | Create administrator session |
| POST | `/admin/auth/logout` | Revoke current session |
| GET | `/admin/auth/session` | Current administrator identity/role |
| GET | `/admin/dashboard` | Actual database-backed KPIs |
| GET | `/admin/analytics` | Booking and source analytics |
| GET/POST/PATCH | `/admin/bookings` | List/create/update booking records and status |
| GET/PATCH | `/admin/guests` | Search/update guest records |
| GET/POST/PATCH/DELETE | `/admin/rooms`, `/admin/room-types` | Room inventory and categories |
| GET/POST/PATCH/DELETE | `/admin/tariffs`, `/admin/seasonal-rates`, `/admin/historical-rates` | Pricing management |
| GET/PATCH | `/admin/enquiries` | Enquiry management |
| GET/POST/PATCH | `/admin/preferences`, `/admin/meal-options` | Guest preferences and meal catalog |
| GET/POST/PATCH/DELETE | `/admin/attractions`, `/admin/cafes` | Local listing management |
| GET/POST/PATCH | `/admin/reviews`, `/admin/notifications`, `/admin/marketing-sources`, `/admin/website-settings` | Content and operations |
| POST | `/admin/weather/refresh` | Refresh weather cache |
| GET/POST/PATCH | `/admin/users` | Administrator management (role restricted) |
| GET | `/admin/reports/bookings.csv`, `/admin/reports/enquiries.csv` | Authenticated exports |
| POST | `/admin/imports/traveller-register/preview` | Validate and preview XLSX without exposing personal fields |
| POST | `/admin/imports/traveller-register` | Import operational rows; optional contact fields require owner attestation and SUPER_ADMIN |
| GET | `/admin/imports` and `/admin/imports/:id/summary` | Import summaries |
| POST | `/admin/imports/:id/revert` | Revert an imported batch where possible |

See [`openapi.yaml`](openapi.yaml) for the route-level machine-readable API contract. Inputs are validated by Zod in the route handlers. Admin writes require an allowed origin when an Origin header is present.

## KPI definitions

The dashboard calculates counts and rates from persisted records. Revenue includes paid booking values only. Occupancy uses active physical rooms and confirmed/completed stay nights. Customer acquisition cost is unavailable (`null`) until marketing spend is recorded. No synthetic production metrics are returned.
