import type { Request, Response } from 'express';
import { ApiError, validationError } from '../../http/api-error.js';
import { asyncHandler } from '../../http/async-handler.js';
import { hasuraRequest } from '../../services/hasura.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';

// ── shared types ──────────────────────────────────────────────────────────────

type Room = {
  room_id: string;
  hotel_id: string;
  room_number: string;
  room_type_id: string;
  price_night: number;
  capacity: number;
  is_available: boolean;
  image_urls: string[];
  created_at: string;
  updated_at: string;
  room_type?: { id: string; name: string } | null;
};

const ROOM_FRAGMENT = `
  room_id
  hotel_id
  room_number
  room_type_id
  price_night
  capacity
  is_available
  image_urls
  created_at
  updated_at
  room_type { id name }
`;

// ── helpers ───────────────────────────────────────────────────────────────────

/** Validates that image_urls, if provided, are HTTPS and at most 5 entries. */
function validateImageUrls(urls: unknown): string[] {
  if (urls === undefined || urls === null) return [];
  if (!Array.isArray(urls)) throw validationError('INVALID_IMAGE_URLS', 'image_urls must be an array.');
  if (urls.length > 5) throw validationError('TOO_MANY_IMAGES', 'image_urls may contain at most 5 URLs.');
  for (const u of urls) {
    if (typeof u !== 'string' || !u.startsWith('https://')) {
      throw validationError('INVALID_IMAGE_URL', `Each image URL must be an HTTPS URL. Got: ${u}`);
    }
  }
  return urls as string[];
}

/** Validates room_number: 1–10 characters, non-empty. */
function validateRoomNumber(num: unknown): string {
  if (typeof num !== 'string' || num.trim().length === 0 || num.trim().length > 10) {
    throw validationError('INVALID_ROOM_NUMBER', 'room_number must be 1–10 characters.');
  }
  return num.trim();
}

// ── GET /api/hotels/:hotelId/rooms ────────────────────────────────────────────

type ListRoomsResult = { rooms: Room[] };

export const listRoomsHandler = asyncHandler(async (
  req: Request<{ hotelId: string }>,
  res: Response,
) => {
  const { hotelId } = req.params;
  if (!hotelId) throw validationError('MISSING_HOTEL_ID', 'hotelId param is required.');

  const data = await hasuraRequest<ListRoomsResult>(
    `query ListRooms($hotel_id: uuid!) {
      rooms(
        where: { hotel_id: { _eq: $hotel_id } }
        order_by: { room_number: asc }
      ) { ${ROOM_FRAGMENT} }
    }`,
    { hotel_id: hotelId },
  );

  res.status(200).json({ rooms: data.rooms });
});

// ── POST /api/hotels/:hotelId/rooms ───────────────────────────────────────────

type CreateRoomBody = {
  room_number: string;
  room_type_id: string;
  capacity: number;
  price_night: number;
  is_available?: boolean;
  image_urls?: string[];
};

type CreateRoomResult = { insert_rooms_one: Room };

export const createRoomHandler = asyncHandler(async (
  req: Request<{ hotelId: string }, unknown, CreateRoomBody> & AuthenticatedRequest,
  res: Response,
) => {
  const { hotelId } = req.params;
  const { room_number, room_type_id, capacity, price_night, is_available = true, image_urls } = req.body;

  if (!hotelId) throw validationError('MISSING_HOTEL_ID', 'hotelId param is required.');
  const validatedNumber = validateRoomNumber(room_number);
  if (!room_type_id) throw validationError('MISSING_ROOM_TYPE', 'room_type_id is required.');
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw validationError('INVALID_CAPACITY', 'capacity must be an integer ≥ 1.');
  }
  if (typeof price_night !== 'number' || price_night <= 0 || !Number.isFinite(price_night)) {
    throw validationError('INVALID_PRICE', 'price_night must be a positive number.');
  }
  const validatedUrls = validateImageUrls(image_urls);

  let data: CreateRoomResult;
  try {
    data = await hasuraRequest<CreateRoomResult>(
      `mutation CreateRoom(
        $hotel_id: uuid!
        $room_number: String!
        $room_type_id: uuid!
        $capacity: Int!
        $price_night: numeric!
        $is_available: Boolean!
        $image_urls: _text
      ) {
        insert_rooms_one(object: {
          hotel_id: $hotel_id
          room_number: $room_number
          room_type_id: $room_type_id
          capacity: $capacity
          price_night: $price_night
          is_available: $is_available
          image_urls: $image_urls
        }) { ${ROOM_FRAGMENT} }
      }`,
      {
        hotel_id: hotelId,
        room_number: validatedNumber,
        room_type_id,
        capacity,
        price_night,
        is_available,
        image_urls: validatedUrls,
      },
    );
  } catch (err: unknown) {
    // Hasura surfaces the unique constraint as a constraint violation
    if (err instanceof Error && err.message.toLowerCase().includes('rooms_unique_number_per_hotel')) {
      throw new ApiError(409, 'ROOM_NUMBER_TAKEN', `Room number '${validatedNumber}' already exists in this hotel.`);
    }
    // also catch the default unique constraint name
    if (err instanceof Error && err.message.toLowerCase().includes('unique') && err.message.toLowerCase().includes('room_number')) {
      throw new ApiError(409, 'ROOM_NUMBER_TAKEN', `Room number '${validatedNumber}' already exists in this hotel.`);
    }
    throw err;
  }

  res.status(201).json({ room: data.insert_rooms_one });
});

// ── PATCH /api/hotels/:hotelId/rooms/:roomId ──────────────────────────────────

type PatchRoomBody = Partial<{
  room_number: string;
  room_type_id: string;
  capacity: number;
  price_night: number;
  is_available: boolean;
  image_urls: string[];
}>;

type PatchRoomResult = { update_rooms_by_pk: Room | null };

export const patchRoomHandler = asyncHandler(async (
  req: Request<{ hotelId: string; roomId: string }, unknown, PatchRoomBody> & AuthenticatedRequest,
  res: Response,
) => {
  const { hotelId, roomId } = req.params;
  if (!hotelId) throw validationError('MISSING_HOTEL_ID', 'hotelId param is required.');
  if (!roomId) throw validationError('MISSING_ROOM_ID', 'roomId param is required.');

  const body = req.body;
  const _set: Record<string, unknown> = {};

  if (body.room_number !== undefined) _set['room_number'] = validateRoomNumber(body.room_number);
  if (body.room_type_id !== undefined) _set['room_type_id'] = body.room_type_id;
  if (body.capacity !== undefined) {
    if (!Number.isInteger(body.capacity) || body.capacity < 1) {
      throw validationError('INVALID_CAPACITY', 'capacity must be an integer ≥ 1.');
    }
    _set['capacity'] = body.capacity;
  }
  if (body.price_night !== undefined) {
    if (typeof body.price_night !== 'number' || body.price_night <= 0 || !Number.isFinite(body.price_night)) {
      throw validationError('INVALID_PRICE', 'price_night must be a positive number.');
    }
    _set['price_night'] = body.price_night;
  }
  if (body.is_available !== undefined) _set['is_available'] = Boolean(body.is_available);
  if (body.image_urls !== undefined) _set['image_urls'] = validateImageUrls(body.image_urls);

  if (Object.keys(_set).length === 0) {
    throw validationError('NO_FIELDS', 'Provide at least one field to update.');
  }

  const data = await hasuraRequest<PatchRoomResult>(
    `mutation PatchRoom(
      $room_id: uuid!
      $hotel_id: uuid!
      $_set: rooms_set_input!
    ) {
      update_rooms_by_pk(
        pk_columns: { room_id: $room_id }
        _set: $_set
      ) { ${ROOM_FRAGMENT} }
    }`,
    { room_id: roomId, hotel_id: hotelId, _set },
  );

  if (!data.update_rooms_by_pk) {
    throw new ApiError(404, 'ROOM_NOT_FOUND', 'Room not found or does not belong to this hotel.');
  }

  // Ensure room belongs to the requested hotel (Hasura returns null if the pk
  // doesn't match, but double-check the returned hotel_id for extra safety)
  if (data.update_rooms_by_pk.hotel_id !== hotelId) {
    throw new ApiError(403, 'ROOM_HOTEL_MISMATCH', 'Room does not belong to this hotel.');
  }

  res.status(200).json({ room: data.update_rooms_by_pk });
});

// ── DELETE /api/hotels/:hotelId/rooms/:roomId ─────────────────────────────────

type CheckReservationsResult = {
  reservations_aggregate: { aggregate: { count: number } };
};

type DeleteRoomResult = { delete_rooms_by_pk: { room_id: string } | null };

export const deleteRoomHandler = asyncHandler(async (
  req: Request<{ hotelId: string; roomId: string }> & AuthenticatedRequest,
  res: Response,
) => {
  const { hotelId, roomId } = req.params;
  if (!hotelId) throw validationError('MISSING_HOTEL_ID', 'hotelId param is required.');
  if (!roomId) throw validationError('MISSING_ROOM_ID', 'roomId param is required.');

  // Guard: reject if the room has active or future reservations
  const check = await hasuraRequest<CheckReservationsResult>(
    `query CheckRoomReservations($room_id: uuid!) {
      reservations_aggregate(where: {
        room_id: { _eq: $room_id }
        reservation_status: { _nin: ["cancelled", "CANCELLED", "expired", "EXPIRED"] }
        check_out: { _gte: "now()" }
      }) {
        aggregate { count }
      }
    }`,
    { room_id: roomId },
  );

  const activeCount = check.reservations_aggregate.aggregate.count;
  if (activeCount > 0) {
    throw new ApiError(
      409,
      'ROOM_HAS_RESERVATIONS',
      'Cannot delete a room with active or future reservations.',
    );
  }

  const data = await hasuraRequest<DeleteRoomResult>(
    `mutation DeleteRoom($room_id: uuid!) {
      delete_rooms_by_pk(room_id: $room_id) { room_id }
    }`,
    { room_id: roomId },
  );

  if (!data.delete_rooms_by_pk) {
    throw new ApiError(404, 'ROOM_NOT_FOUND', 'Room not found or does not belong to this hotel.');
  }

  res.status(200).json({ deleted: true, room_id: data.delete_rooms_by_pk.room_id });
});

// ── GET /api/hotels/:hotelId/available-rooms ──────────────────────────────────

type AvailableRoomsResult = { available_rooms: Room[] };

export const availableRoomsHandler = asyncHandler(async (
  req: Request<{ hotelId: string }>,
  res: Response,
) => {
  const { hotelId } = req.params;
  const { check_in, check_out } = req.query as { check_in?: string; check_out?: string };

  if (!hotelId) throw validationError('MISSING_HOTEL_ID', 'hotelId param is required.');
  if (!check_in) throw validationError('MISSING_CHECK_IN', 'check_in query param is required (YYYY-MM-DD).');
  if (!check_out) throw validationError('MISSING_CHECK_OUT', 'check_out query param is required (YYYY-MM-DD).');

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(check_in)) throw validationError('INVALID_CHECK_IN', 'check_in must be YYYY-MM-DD.');
  if (!dateRe.test(check_out)) throw validationError('INVALID_CHECK_OUT', 'check_out must be YYYY-MM-DD.');
  if (check_out <= check_in) throw validationError('INVALID_DATE_RANGE', 'check_out must be after check_in.');

  const data = await hasuraRequest<AvailableRoomsResult>(
    `query AvailableRooms(
      $hotel_id: uuid!
      $check_in: date!
      $check_out: date!
    ) {
      available_rooms(
        args: { p_hotel_id: $hotel_id, p_check_in: $check_in, p_check_out: $check_out }
        order_by: { room_number: asc }
      ) { ${ROOM_FRAGMENT} }
    }`,
    { hotel_id: hotelId, check_in, check_out },
  );

  res.status(200).json({ rooms: data.available_rooms });
});
