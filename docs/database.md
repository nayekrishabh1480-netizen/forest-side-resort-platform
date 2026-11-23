# Database guide

PostgreSQL schema is defined in `apps/api/prisma/schema.prisma`; migrations are in `apps/api/prisma/migrations`. Prisma owns relational access, while the initial SQL migration includes additional `CHECK` constraints and a GiST exclusion constraint for confirmed room bookings.

## Main relationships

- `RoomType` has many `Room` records; each room has one room type.
- `Guest` has bookings, enquiries, preferences and optional meal preferences. A booking has a lead guest and optional `BookingGuest` occupants.
- `Booking` may refer to a room, room type, guest, marketing source and creator administrator. Public requests can have no assigned room.
- `SeasonalRate` belongs to a room type; `HistoricalRate` stores an effective date interval and optional source seasonal rate.
- `GuestPreference` belongs to a guest and may reference a `MealOption`.
- `Attraction` and `Cafe` are public content records; `Review` is public only when verified and published.
- `WeatherRecord` stores cached provider results; `NotificationLog` stores provider status and masked destination details.
- `AdminUser` owns `AdminSession` records. `ImportBatch` owns private operational traveller-register rows and may be linked to guests only when explicitly authorized.

## Data protection

No identity-proof field is modeled. The importer ignores age, nationality, permanent address and ID-proof columns. Imported contact fields are not retained by default; explicit SUPER_ADMIN authorization is required. Traveller import endpoints are private, and public APIs do not expose the register or guest records. Use synthetic records for development.

## Migration and backup operations

- Local development: `npm run prisma:migrate`.
- Production deployment: `npm run prisma:deploy`.
- Client regeneration after schema changes: `npm run prisma:generate`.
- Back up the Render PostgreSQL database using provider snapshots or `pg_dump` with credentials supplied through a secure environment. Store backups encrypted and outside the application repository. Test restoration into a separate database before relying on a backup.
- Do not run destructive schema changes against production without reviewing the generated SQL and taking a current backup.
