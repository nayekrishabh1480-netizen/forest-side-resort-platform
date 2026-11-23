-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PAID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "DayType" AS ENUM ('ANY', 'WEEKDAY', 'WEEKEND');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEWED', 'COMPLETED', 'REVERTED', 'FAILED');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "passwordHash" VARCHAR(100) NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "adminUserId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guests" (
    "id" UUID NOT NULL,
    "fullName" VARCHAR(180),
    "phone" VARCHAR(40),
    "email" VARCHAR(320),
    "notes" VARCHAR(2000),
    "marketingSourceId" UUID,
    "sourceImportBatchId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_types" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "description" VARCHAR(3000),
    "maxOccupancy" INTEGER NOT NULL DEFAULT 2,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "room_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "roomNumber" VARCHAR(40) NOT NULL,
    "roomTypeId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "guestId" UUID NOT NULL,
    "roomId" UUID,
    "roomTypeId" UUID,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "guestCount" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "totalAmount" DECIMAL(10,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "specialRequests" VARCHAR(2000),
    "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false,
    "whatsappOptInAt" TIMESTAMPTZ(3),
    "source" VARCHAR(80),
    "confirmedByAdminId" UUID,
    "confirmedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_guests" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "guestId" UUID NOT NULL,
    "role" VARCHAR(24) NOT NULL DEFAULT 'COMPANION',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiries" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "guestId" UUID,
    "name" VARCHAR(180) NOT NULL,
    "phone" VARCHAR(40) NOT NULL,
    "email" VARCHAR(320),
    "message" VARCHAR(4000) NOT NULL,
    "checkIn" DATE,
    "checkOut" DATE,
    "guestCount" INTEGER,
    "status" VARCHAR(24) NOT NULL DEFAULT 'NEW',
    "source" VARCHAR(80),
    "respondedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasonal_rates" (
    "id" UUID NOT NULL,
    "roomTypeId" UUID,
    "name" VARCHAR(120) NOT NULL,
    "season" VARCHAR(80) NOT NULL,
    "dayType" "DayType" NOT NULL DEFAULT 'ANY',
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "validFrom" DATE NOT NULL,
    "validTo" DATE NOT NULL,
    "specialDate" DATE,
    "extraCharges" JSONB NOT NULL DEFAULT '[]',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seasonal_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historical_rates" (
    "id" UUID NOT NULL,
    "roomTypeId" UUID,
    "name" VARCHAR(120) NOT NULL,
    "season" VARCHAR(80) NOT NULL,
    "dayType" "DayType" NOT NULL DEFAULT 'ANY',
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historical_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_preferences" (
    "id" UUID NOT NULL,
    "guestId" UUID NOT NULL,
    "dietaryPreference" VARCHAR(120),
    "allergies" VARCHAR(1000),
    "specialNeeds" VARCHAR(2000),
    "arrivalMealTime" VARCHAR(20),
    "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false,
    "whatsappOptInAt" TIMESTAMPTZ(3),
    "consentSource" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guest_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_options" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "price" DECIMAL(10,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "isAvailable" BOOLEAN NOT NULL DEFAULT false,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "meal_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attractions" (
    "id" UUID NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "description" VARCHAR(2000),
    "distanceKm" DECIMAL(8,2),
    "address" VARCHAR(500),
    "mapsUrl" VARCHAR(1000),
    "photoUrl" VARCHAR(1000),
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cafes" (
    "id" UUID NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "description" VARCHAR(2000),
    "address" VARCHAR(500),
    "distanceKm" DECIMAL(8,2),
    "mapsUrl" VARCHAR(1000),
    "openingHours" VARCHAR(500),
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cafes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weather_records" (
    "id" UUID NOT NULL,
    "locationName" VARCHAR(180) NOT NULL,
    "source" VARCHAR(120) NOT NULL,
    "temperatureC" DECIMAL(5,2),
    "relativeHumidityPct" INTEGER,
    "precipitationMm" DECIMAL(7,2),
    "rainProbabilityPct" INTEGER,
    "conditionCode" INTEGER,
    "forecast" JSONB,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "weather_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "messageType" VARCHAR(80) NOT NULL,
    "recipientMasked" VARCHAR(80),
    "providerMessageId" VARCHAR(180),
    "failureCode" VARCHAR(80),
    "guestId" UUID,
    "bookingId" UUID,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "guestName" VARCHAR(120),
    "rating" INTEGER NOT NULL,
    "body" VARCHAR(3000) NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "stayDate" DATE,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_sources" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_settings" (
    "id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "value" JSONB NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "website_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEWED',
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "rowsImported" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "rowsFailed" INTEGER NOT NULL DEFAULT 0,
    "personalDataIncluded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "revertedAt" TIMESTAMPTZ(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traveller_register_entries" (
    "id" UUID NOT NULL,
    "importBatchId" UUID NOT NULL,
    "guestId" UUID,
    "sourceRowNumber" INTEGER NOT NULL,
    "travellerCount" INTEGER,
    "travelFrom" VARCHAR(180),
    "travelTo" VARCHAR(180),
    "arrivalDate" DATE,
    "departureDate" DATE,
    "operationalHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "traveller_register_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_users_isActive_role_idx" ON "admin_users"("isActive", "role");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_tokenHash_key" ON "admin_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "admin_sessions_adminUserId_expiresAt_idx" ON "admin_sessions"("adminUserId", "expiresAt");

-- CreateIndex
CREATE INDEX "admin_sessions_expiresAt_idx" ON "admin_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "guests_phone_idx" ON "guests"("phone");

-- CreateIndex
CREATE INDEX "guests_email_idx" ON "guests"("email");

-- CreateIndex
CREATE INDEX "guests_sourceImportBatchId_idx" ON "guests"("sourceImportBatchId");

-- CreateIndex
CREATE INDEX "guests_createdAt_idx" ON "guests"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "room_types_name_key" ON "room_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "room_types_slug_key" ON "room_types"("slug");

-- CreateIndex
CREATE INDEX "room_types_isActive_name_idx" ON "room_types"("isActive", "name");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_roomNumber_key" ON "rooms"("roomNumber");

-- CreateIndex
CREATE INDEX "rooms_roomTypeId_isActive_idx" ON "rooms"("roomTypeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_reference_key" ON "bookings"("reference");

-- CreateIndex
CREATE INDEX "bookings_checkIn_checkOut_status_idx" ON "bookings"("checkIn", "checkOut", "status");

-- CreateIndex
CREATE INDEX "bookings_guestId_createdAt_idx" ON "bookings"("guestId", "createdAt");

-- CreateIndex
CREATE INDEX "bookings_status_createdAt_idx" ON "bookings"("status", "createdAt");

-- CreateIndex
CREATE INDEX "bookings_roomId_status_checkIn_checkOut_idx" ON "bookings"("roomId", "status", "checkIn", "checkOut");

-- CreateIndex
CREATE INDEX "booking_guests_guestId_idx" ON "booking_guests"("guestId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_guests_bookingId_guestId_key" ON "booking_guests"("bookingId", "guestId");

-- CreateIndex
CREATE UNIQUE INDEX "enquiries_reference_key" ON "enquiries"("reference");

-- CreateIndex
CREATE INDEX "enquiries_status_createdAt_idx" ON "enquiries"("status", "createdAt");

-- CreateIndex
CREATE INDEX "enquiries_phone_idx" ON "enquiries"("phone");

-- CreateIndex
CREATE INDEX "seasonal_rates_isPublished_isActive_validFrom_validTo_idx" ON "seasonal_rates"("isPublished", "isActive", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "seasonal_rates_roomTypeId_season_dayType_idx" ON "seasonal_rates"("roomTypeId", "season", "dayType");

-- CreateIndex
CREATE INDEX "historical_rates_isPublished_effectiveFrom_effectiveTo_idx" ON "historical_rates"("isPublished", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "historical_rates_roomTypeId_season_idx" ON "historical_rates"("roomTypeId", "season");

-- CreateIndex
CREATE UNIQUE INDEX "guest_preferences_guestId_key" ON "guest_preferences"("guestId");

-- CreateIndex
CREATE UNIQUE INDEX "meal_options_name_key" ON "meal_options"("name");

-- CreateIndex
CREATE INDEX "meal_options_isPublished_sortOrder_idx" ON "meal_options"("isPublished", "sortOrder");

-- CreateIndex
CREATE INDEX "attractions_isPublished_name_idx" ON "attractions"("isPublished", "name");

-- CreateIndex
CREATE INDEX "cafes_isPublished_name_idx" ON "cafes"("isPublished", "name");

-- CreateIndex
CREATE INDEX "weather_records_locationName_fetchedAt_idx" ON "weather_records"("locationName", "fetchedAt");

-- CreateIndex
CREATE INDEX "weather_records_expiresAt_idx" ON "weather_records"("expiresAt");

-- CreateIndex
CREATE INDEX "notification_logs_status_createdAt_idx" ON "notification_logs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "notification_logs_channel_messageType_createdAt_idx" ON "notification_logs"("channel", "messageType", "createdAt");

-- CreateIndex
CREATE INDEX "reviews_status_publishedAt_idx" ON "reviews"("status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_sources_name_key" ON "marketing_sources"("name");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_sources_slug_key" ON "marketing_sources"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "website_settings_key_key" ON "website_settings"("key");

-- CreateIndex
CREATE INDEX "import_batches_status_createdAt_idx" ON "import_batches"("status", "createdAt");

-- CreateIndex
CREATE INDEX "traveller_register_entries_operationalHash_idx" ON "traveller_register_entries"("operationalHash");

-- CreateIndex
CREATE INDEX "traveller_register_entries_arrivalDate_departureDate_idx" ON "traveller_register_entries"("arrivalDate", "departureDate");

-- CreateIndex
CREATE UNIQUE INDEX "traveller_register_entries_importBatchId_sourceRowNumber_key" ON "traveller_register_entries"("importBatchId", "sourceRowNumber");

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guests" ADD CONSTRAINT "guests_marketingSourceId_fkey" FOREIGN KEY ("marketingSourceId") REFERENCES "marketing_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guests" ADD CONSTRAINT "guests_sourceImportBatchId_fkey" FOREIGN KEY ("sourceImportBatchId") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_confirmedByAdminId_fkey" FOREIGN KEY ("confirmedByAdminId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_guests" ADD CONSTRAINT "booking_guests_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_guests" ADD CONSTRAINT "booking_guests_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasonal_rates" ADD CONSTRAINT "seasonal_rates_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasonal_rates" ADD CONSTRAINT "seasonal_rates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_rates" ADD CONSTRAINT "historical_rates_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_preferences" ADD CONSTRAINT "guest_preferences_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traveller_register_entries" ADD CONSTRAINT "traveller_register_entries_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traveller_register_entries" ADD CONSTRAINT "traveller_register_entries_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Database-level business invariants. Advisory locking in the service gives a clear
-- application error; this exclusion constraint remains the final overlap guard.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_dates_order_check" CHECK ("checkIn" < "checkOut");
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guest_count_check" CHECK ("guestCount" BETWEEN 1 AND 20);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_confirmed_requires_room_check" CHECK ("status" <> 'CONFIRMED' OR "roomId" IS NOT NULL);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_confirmed_room_no_overlap" EXCLUDE USING gist (
  "roomId" WITH =,
  daterange("checkIn", "checkOut", '[)') WITH &&
) WHERE ("status" = 'CONFIRMED');

ALTER TABLE "room_types" ADD CONSTRAINT "room_types_occupancy_check" CHECK ("maxOccupancy" BETWEEN 1 AND 30);
ALTER TABLE "seasonal_rates" ADD CONSTRAINT "seasonal_rates_date_order_check" CHECK ("validFrom" <= "validTo");
ALTER TABLE "seasonal_rates" ADD CONSTRAINT "seasonal_rates_amount_check" CHECK ("amount" >= 0);
ALTER TABLE "historical_rates" ADD CONSTRAINT "historical_rates_amount_check" CHECK ("amount" >= 0);
ALTER TABLE "historical_rates" ADD CONSTRAINT "historical_rates_date_order_check" CHECK ("effectiveTo" IS NULL OR "effectiveFrom" <= "effectiveTo");
ALTER TABLE "meal_options" ADD CONSTRAINT "meal_options_price_check" CHECK ("price" IS NULL OR "price" >= 0);
ALTER TABLE "attractions" ADD CONSTRAINT "attractions_distance_check" CHECK ("distanceKm" IS NULL OR "distanceKm" >= 0);
ALTER TABLE "cafes" ADD CONSTRAINT "cafes_distance_check" CHECK ("distanceKm" IS NULL OR "distanceKm" >= 0);
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "weather_records" ADD CONSTRAINT "weather_humidity_check" CHECK ("relativeHumidityPct" IS NULL OR "relativeHumidityPct" BETWEEN 0 AND 100);
ALTER TABLE "weather_records" ADD CONSTRAINT "weather_rain_probability_check" CHECK ("rainProbabilityPct" IS NULL OR "rainProbabilityPct" BETWEEN 0 AND 100);

