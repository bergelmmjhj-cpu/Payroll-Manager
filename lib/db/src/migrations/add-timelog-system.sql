-- Phase 1: Extend auth_users with worker link and role
ALTER TABLE auth_users
  ADD COLUMN IF NOT EXISTS worker_id integer REFERENCES workers(id),
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin';

-- Phase 2: Add geofence fields to hotels
ALTER TABLE hotels
  ADD COLUMN IF NOT EXISTS latitude  numeric(10, 7),
  ADD COLUMN IF NOT EXISTS longitude numeric(10, 7),
  ADD COLUMN IF NOT EXISTS geofence_radius_meters integer NOT NULL DEFAULT 200;

-- Phase 3: Raw worker clock-in / clock-out records
CREATE TABLE IF NOT EXISTS shift_logs (
  id                        SERIAL PRIMARY KEY,
  worker_id                 integer NOT NULL REFERENCES workers(id),
  hotel_id                  integer NOT NULL REFERENCES hotels(id),
  clock_in_at               timestamptz,
  clock_out_at              timestamptz,
  clock_in_latitude         numeric(10, 7),
  clock_in_longitude        numeric(10, 7),
  clock_out_latitude        numeric(10, 7),
  clock_out_longitude       numeric(10, 7),
  clock_in_distance_meters  numeric(8, 2),
  clock_out_distance_meters numeric(8, 2),
  status                    text NOT NULL DEFAULT 'open',
  -- 'open' | 'pending_approval' | 'approved' | 'rejected' | 'correction_requested'
  submitted_at              timestamptz,
  notes                     text,
  time_entry_id             integer REFERENCES time_entries(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_logs_worker ON shift_logs(worker_id);
CREATE INDEX IF NOT EXISTS idx_shift_logs_hotel  ON shift_logs(hotel_id);
CREATE INDEX IF NOT EXISTS idx_shift_logs_status ON shift_logs(status);

-- Phase 4: Approval / signoff records
CREATE TABLE IF NOT EXISTS shift_approvals (
  id                    SERIAL PRIMARY KEY,
  shift_log_id          integer NOT NULL REFERENCES shift_logs(id),
  approver_auth_user_id integer REFERENCES auth_users(id),
  approver_name         text NOT NULL,
  approver_email        text,
  approval_status       text NOT NULL,   -- 'approved' | 'rejected'
  confirmed_by_checkbox boolean NOT NULL DEFAULT false,
  signature_data        text,            -- base64 data URI, reserved for future
  notes                 text,
  ip_address            text,
  approved_at           timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Phase 5: Worker-initiated correction requests
CREATE TABLE IF NOT EXISTS correction_requests (
  id                        SERIAL PRIMARY KEY,
  shift_log_id              integer NOT NULL REFERENCES shift_logs(id),
  requested_by_worker_id    integer NOT NULL REFERENCES workers(id),
  original_clock_in         timestamptz,
  original_clock_out        timestamptz,
  requested_clock_in        timestamptz,
  requested_clock_out       timestamptz,
  reason                    text NOT NULL,
  status                    text NOT NULL DEFAULT 'pending',
  -- 'pending' | 'approved' | 'rejected'
  reviewed_by_auth_user_id  integer REFERENCES auth_users(id),
  review_notes              text,
  reviewed_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- Phase 6: Geofence attempt audit (allowed + blocked)
CREATE TABLE IF NOT EXISTS shift_geofence_events (
  id             SERIAL PRIMARY KEY,
  worker_id      integer NOT NULL REFERENCES workers(id),
  hotel_id       integer NOT NULL REFERENCES hotels(id),
  action         text NOT NULL,  -- 'clock_in' | 'clock_out'
  event_result   text NOT NULL,  -- 'allowed' | 'blocked' | 'missing_location' | 'missing_hotel_coords' | 'not_found'
  latitude       numeric(10, 7),
  longitude      numeric(10, 7),
  distance_meters numeric(8, 2),
  message        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_geofence_events_worker ON shift_geofence_events(worker_id);
CREATE INDEX IF NOT EXISTS idx_shift_geofence_events_hotel  ON shift_geofence_events(hotel_id);
CREATE INDEX IF NOT EXISTS idx_shift_geofence_events_action ON shift_geofence_events(action);
