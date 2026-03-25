-- Add hotel sections per pay period and richer hours breakdown on time entries

CREATE TABLE IF NOT EXISTS pay_period_hotels (
  id SERIAL PRIMARY KEY,
  period_id INTEGER NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
  hotel_id INTEGER NOT NULL,
  hotel_name TEXT NOT NULL,
  region TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS pay_period_hotel_id INTEGER REFERENCES pay_period_hotels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS role TEXT,
  ADD COLUMN IF NOT EXISTS regular_hours NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS overtime_hours NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS other_hours NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS total_hours NUMERIC(8,2);

CREATE INDEX IF NOT EXISTS idx_pay_period_hotels_period_id ON pay_period_hotels(period_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_pay_period_hotel_id ON time_entries(pay_period_hotel_id);
