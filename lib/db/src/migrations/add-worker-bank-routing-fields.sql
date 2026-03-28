ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS institution_number text,
  ADD COLUMN IF NOT EXISTS transit_number text,
  ADD COLUMN IF NOT EXISTS account_number text;