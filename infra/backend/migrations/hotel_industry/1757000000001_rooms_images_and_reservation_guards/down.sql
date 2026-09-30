-- Rollback for 1757000000001_rooms_images_and_reservation_guards
DROP FUNCTION IF EXISTS available_rooms(UUID, DATE, DATE);

DROP INDEX IF EXISTS idx_reservations_room_dates;

ALTER TABLE reservations
  DROP CONSTRAINT IF EXISTS reservations_no_overlap;

ALTER TABLE reservations
  DROP CONSTRAINT IF EXISTS reservations_valid_dates;

ALTER TABLE rooms
  DROP COLUMN IF EXISTS image_urls;

ALTER TABLE rooms
  DROP COLUMN IF EXISTS is_available;
