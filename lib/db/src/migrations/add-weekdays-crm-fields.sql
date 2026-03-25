-- Add Weekdays CRM integration fields to hotels table
ALTER TABLE "hotels" ADD COLUMN IF NOT EXISTS "external_id" TEXT UNIQUE;
ALTER TABLE "hotels" ADD COLUMN IF NOT EXISTS "hiring_status" TEXT NOT NULL DEFAULT 'open';
ALTER TABLE "hotels" ADD COLUMN IF NOT EXISTS "pay_rate" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hotels" ADD COLUMN IF NOT EXISTS "job_position" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hotels" ADD COLUMN IF NOT EXISTS "positions" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS "IDX_hotels_external_id" ON "hotels" ("external_id");
