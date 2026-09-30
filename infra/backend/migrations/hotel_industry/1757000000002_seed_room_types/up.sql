-- ── Migration: 1757000000002_seed_room_types
-- Seeds the canonical room types: Single, Double, Suite.
-- Uses ON CONFLICT DO NOTHING so re-running the migration is idempotent.

INSERT INTO room_types (name, description)
VALUES
  ('Single', 'A room with a single bed, suitable for one guest.'),
  ('Double', 'A room with a double or twin beds, suitable for two guests.'),
  ('Suite',  'A premium suite with a separate living area and enhanced amenities.')
ON CONFLICT (name) DO NOTHING;
