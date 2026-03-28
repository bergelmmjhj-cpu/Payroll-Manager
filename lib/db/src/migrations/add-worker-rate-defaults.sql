ALTER TABLE "workers"
  ADD COLUMN IF NOT EXISTS "default_rate" NUMERIC(8,2);

CREATE TABLE IF NOT EXISTS "worker_hotel_rates" (
  "id" SERIAL PRIMARY KEY,
  "worker_id" INTEGER NOT NULL REFERENCES "workers"("id") ON DELETE CASCADE,
  "hotel_id" INTEGER NOT NULL REFERENCES "hotels"("id") ON DELETE CASCADE,
  "role" TEXT,
  "rate" NUMERIC(8,2) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "IDX_worker_hotel_rates_worker_hotel"
  ON "worker_hotel_rates" ("worker_id", "hotel_id");

CREATE INDEX IF NOT EXISTS "IDX_worker_hotel_rates_role"
  ON "worker_hotel_rates" ("role");