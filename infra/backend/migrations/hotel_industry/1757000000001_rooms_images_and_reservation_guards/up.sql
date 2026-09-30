-- ── Migration: 1757000000001_rooms_images_and_reservation_guards
-- Adds:
--   1. is_available BOOLEAN column to rooms (replaces the old status boolean)
--   2. image_urls TEXT[] column to rooms (up to 5 HTTPS URLs)
--   3. btree_gist extension (required by the exclusion constraint)
--   4. reservations_valid_dates CHECK (check_out > check_in)
--   5. reservations_no_overlap exclusion constraint (prevents double-booking)
--   6. available_rooms() set-returning function

-- 1. Add is_available to rooms (manual on/off switch, not a calendar)
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT true;

-- Back-fill from the old status column if data exists
UPDATE rooms SET is_available = COALESCE(status, true);

-- 2. Add image_urls array (up to 5 HTTPS URLs stored as TEXT[])
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] DEFAULT '{}';

-- 3. btree_gist is required by the exclusion constraint on daterange
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 4. Check constraint: check_out must be after check_in
ALTER TABLE reservations
  ADD CONSTRAINT IF NOT EXISTS reservations_valid_dates
    CHECK (check_out > check_in);

-- 5. Exclusion constraint: no two non-cancelled reservations may overlap
--    for the same room.  Back-to-back stays are fine (']' = exclusive upper
--    bound so [day1,day2) and [day2,day3) do not overlap).
ALTER TABLE reservations
  ADD CONSTRAINT IF NOT EXISTS reservations_no_overlap
    EXCLUDE USING gist (
      room_id WITH =,
      daterange(check_in::date, check_out::date, '[)') WITH &&
    )
    WHERE (reservation_status <> 'cancelled');

-- Index to speed up the overlap look-up inside available_rooms()
CREATE INDEX IF NOT EXISTS idx_reservations_room_dates
  ON reservations (room_id, check_in, check_out)
  WHERE reservation_status <> 'cancelled';

-- 6. available_rooms(hotel_id, check_in, check_out)
--    Returns every room for the hotel that is:
--      a) flagged is_available = true, AND
--      b) has no overlapping non-cancelled reservation for the date range.
--    The booking UI picks rooms ONLY from this function.
--    The exclusion constraint on reservations is the final guard at insert time.
CREATE OR REPLACE FUNCTION available_rooms(
  p_hotel_id   UUID,
  p_check_in   DATE,
  p_check_out  DATE
)
RETURNS SETOF rooms
LANGUAGE sql STABLE AS $$
  SELECT r.*
  FROM   rooms r
  WHERE  r.hotel_id     = p_hotel_id
    AND  r.is_available = true
    AND  NOT EXISTS (
           SELECT 1
           FROM   reservations x
           WHERE  x.room_id = r.room_id
             AND  x.reservation_status <> 'cancelled'
             AND  daterange(x.check_in::date, x.check_out::date, '[)')
                  &&
                  daterange(p_check_in, p_check_out, '[)')
         );
$$;
