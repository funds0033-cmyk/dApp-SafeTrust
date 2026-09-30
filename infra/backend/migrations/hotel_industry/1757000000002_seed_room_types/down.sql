-- Rollback for 1757000000002_seed_room_types
DELETE FROM room_types WHERE name IN ('Single', 'Double', 'Suite');
