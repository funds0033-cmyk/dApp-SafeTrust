import { Router } from 'express';
import type { RequestHandler } from 'express';
import { authenticateFirebase } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/require-role.js';
import {
  listRoomsHandler,
  createRoomHandler,
  patchRoomHandler,
  deleteRoomHandler,
  availableRoomsHandler,
} from './rooms.handler.js';

const router = Router({ mergeParams: true });

/**
 * Room management routes for hotel_industry.
 * Mounted at /api/hotels — all :hotelId routes are scoped to that hotel.
 *
 * Read (auth required, any role):
 *   GET  /api/hotels/:hotelId/rooms              — list all rooms
 *   GET  /api/hotels/:hotelId/available-rooms    — rooms free for a date range
 *
 * Write (host | admin only):
 *   POST   /api/hotels/:hotelId/rooms            — create a room
 *   PATCH  /api/hotels/:hotelId/rooms/:roomId    — edit a room
 *   DELETE /api/hotels/:hotelId/rooms/:roomId    — delete (409 if reserved)
 */

const hostOrAdmin = requireRole(['host', 'admin']) as unknown as RequestHandler;

// Read
router.get('/:hotelId/rooms', authenticateFirebase, listRoomsHandler);
router.get('/:hotelId/available-rooms', authenticateFirebase, availableRoomsHandler);

// Writes — host or admin only
router.post(
  '/:hotelId/rooms',
  authenticateFirebase,
  hostOrAdmin,
  createRoomHandler as unknown as RequestHandler,
);

router.patch(
  '/:hotelId/rooms/:roomId',
  authenticateFirebase,
  hostOrAdmin,
  patchRoomHandler as unknown as RequestHandler,
);

router.delete(
  '/:hotelId/rooms/:roomId',
  authenticateFirebase,
  hostOrAdmin,
  deleteRoomHandler as unknown as RequestHandler,
);

export default router;
