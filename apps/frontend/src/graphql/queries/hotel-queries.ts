import { gql } from "@apollo/client";

// Aligned to hotel_industry SQL from issue #293 (not the prose typos in #294).
// room_types.name (not type_name); escrow amount via reservation.total_amount.

// ── Shared fragment ──────────────────────────────────────────────────────────
// is_available (manual switch) and image_urls (TEXT[]) added by migration
// 1757000000001_rooms_images_and_reservation_guards.
const ROOM_FIELDS = `
  room_id
  hotel_id
  room_number
  status
  is_available
  price_night
  capacity
  image_urls
  room_type {
    id
    name
  }
`;

export const GET_HOTEL_ROOMS = gql`
  query GetHotelRooms($hotel_id: uuid) {
    rooms(
      where: { hotel_id: { _eq: $hotel_id } }
      order_by: { room_number: asc }
    ) {
      ${ROOM_FIELDS}
    }
  }
`;

// ── Room mutations ────────────────────────────────────────────────────────────

export const CREATE_ROOM = gql`
  mutation CreateRoom(
    $hotel_id: uuid!
    $room_number: String!
    $room_type_id: uuid!
    $capacity: Int!
    $price_night: numeric!
    $is_available: Boolean!
    $image_urls: _text
  ) {
    insert_rooms_one(
      object: {
        hotel_id: $hotel_id
        room_number: $room_number
        room_type_id: $room_type_id
        capacity: $capacity
        price_night: $price_night
        is_available: $is_available
        image_urls: $image_urls
      }
    ) {
      ${ROOM_FIELDS}
    }
  }
`;

export const UPDATE_ROOM = gql`
  mutation UpdateRoom($room_id: uuid!, $_set: rooms_set_input!) {
    update_rooms_by_pk(pk_columns: { room_id: $room_id }, _set: $_set) {
      ${ROOM_FIELDS}
    }
  }
`;

export const DELETE_ROOM = gql`
  mutation DeleteRoom($room_id: uuid!) {
    delete_rooms_by_pk(room_id: $room_id) {
      room_id
    }
  }
`;

// ── Available rooms (calls available_rooms() Hasura-tracked function) ─────────

export const GET_AVAILABLE_ROOMS = gql`
  query GetAvailableRooms(
    $hotel_id: uuid!
    $check_in: date!
    $check_out: date!
  ) {
    available_rooms(
      args: {
        p_hotel_id: $hotel_id
        p_check_in: $check_in
        p_check_out: $check_out
      }
      order_by: { room_number: asc }
    ) {
      ${ROOM_FIELDS}
    }
  }
`;

export const GET_ACTIVE_RESERVATIONS = gql`
  query GetActiveReservations {
    reservations(
      where: { reservation_status: { _in: ["PENDING", "CONFIRMED"] } }
      order_by: { check_in: asc }
    ) {
      id
      reservation_status
      check_in
      check_out
      total_amount
      room {
        room_number
        hotel {
          name
        }
      }
    }
  }
`;

export const GET_HOTEL_ESCROW_TRANSACTIONS = gql`
  query GetHotelEscrowTransactions {
    escrow_transactions(order_by: { created_at: desc }, limit: 10) {
      id
      contract_id
      escrow_status
      signer_address
      created_at
      reservation {
        id
        reservation_status
        total_amount
      }
    }
  }
`;

// ── Room types (seed: Single, Double, Suite) ──────────────────────────────────

export const GET_ROOM_TYPES = gql`
  query GetRoomTypes {
    room_types(order_by: { name: asc }) {
      id
      name
    }
  }
`;
