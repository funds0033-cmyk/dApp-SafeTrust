"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@apollo/client";
import { PlusCircle, Pencil, Trash2, Hotel, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  GET_HOTEL_ROOMS,
  CREATE_ROOM,
  UPDATE_ROOM,
  DELETE_ROOM,
} from "@/graphql/queries/hotel-queries";

// ── Types ─────────────────────────────────────────────────────────────────────

type RoomType = { id: string; name: string };

type Room = {
  room_id: string;
  hotel_id: string;
  room_number: string;
  status: boolean | null;
  is_available: boolean;
  price_night: number;
  capacity: number;
  image_urls: string[] | null;
  room_type: RoomType | null;
};

type RoomsTabProps = {
  /** UUID of the hotel whose rooms to manage. */
  hotelId: string;
  /** Room types available for the select dropdown (seed: Single, Double, Suite). */
  roomTypes: RoomType[];
  /** Whether the current user is a manager/admin (shows write controls). */
  canManage?: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function AvailabilityBadge({ available }: { available: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        available
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
          : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
      )}
    >
      {available ? "Available" : "Unavailable"}
    </span>
  );
}

// ── Empty form state ──────────────────────────────────────────────────────────

const EMPTY_FORM = {
  room_number: "",
  room_type_id: "",
  capacity: 1,
  price_night: 0,
  is_available: true,
  image_urls: "",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function RoomsTab({ hotelId, roomTypes, canManage = false }: RoomsTabProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data, loading, refetch } = useQuery<{ rooms: Room[] }>(
    GET_HOTEL_ROOMS,
    { variables: { hotel_id: hotelId }, skip: !hotelId },
  );

  const rooms = data?.rooms ?? [];

  // ── Mutations ─────────────────────────────────────────────────────────────
  const [createRoom, { loading: creating }] = useMutation(CREATE_ROOM, {
    onCompleted: () => { resetForm(); void refetch(); },
    onError: (e) => setFormError(e.message),
  });

  const [updateRoom, { loading: updating }] = useMutation(UPDATE_ROOM, {
    onCompleted: () => { resetForm(); void refetch(); },
    onError: (e) => setFormError(e.message),
  });

  const [deleteRoom, { loading: deleting }] = useMutation(DELETE_ROOM, {
    onCompleted: () => { setDeleteConfirmId(null); void refetch(); },
    onError: (e) => setFormError(e.message),
  });

  // ── Form helpers ──────────────────────────────────────────────────────────
  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingRoom(null);
    setShowForm(false);
    setFormError(null);
  }

  function openCreate() {
    setEditingRoom(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(room: Room) {
    setEditingRoom(room);
    setForm({
      room_number: room.room_number,
      room_type_id: room.room_type?.id ?? "",
      capacity: room.capacity,
      price_night: room.price_night,
      is_available: room.is_available,
      image_urls: (room.image_urls ?? []).join(", "),
    });
    setFormError(null);
    setShowForm(true);
  }

  function parseImageUrls(raw: string): string[] {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const imageUrls = parseImageUrls(form.image_urls);
    if (imageUrls.some((u) => !u.startsWith("https://"))) {
      setFormError("Each image URL must start with https://");
      return;
    }
    if (imageUrls.length > 5) {
      setFormError("You can add at most 5 image URLs.");
      return;
    }

    if (editingRoom) {
      void updateRoom({
        variables: {
          room_id: editingRoom.room_id,
          _set: {
            room_number: form.room_number.trim(),
            room_type_id: form.room_type_id || undefined,
            capacity: Number(form.capacity),
            price_night: Number(form.price_night),
            is_available: form.is_available,
            image_urls: imageUrls,
          },
        },
      });
    } else {
      void createRoom({
        variables: {
          hotel_id: hotelId,
          room_number: form.room_number.trim(),
          room_type_id: form.room_type_id,
          capacity: Number(form.capacity),
          price_night: Number(form.price_night),
          is_available: form.is_available,
          image_urls: imageUrls,
        },
      });
    }
  }

  const isMutating = creating || updating || deleting;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Hotel className="h-5 w-5 text-muted-foreground" />
            Rooms
          </CardTitle>
          {canManage && !showForm && (
            <Button size="sm" variant="outline" onClick={openCreate}>
              <PlusCircle className="mr-1.5 h-4 w-4" />
              Add room
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Inline form ──────────────────────────────────────────────── */}
        {showForm && canManage && (
          <form
            onSubmit={handleSubmit}
            className="rounded-md border border-border/60 bg-muted/40 p-4 space-y-3"
            aria-label={editingRoom ? "Edit room" : "Add room"}
          >
            <p className="text-sm font-semibold">
              {editingRoom ? "Edit room" : "New room"}
            </p>

            {formError && (
              <p role="alert" className="text-xs text-destructive">
                {formError}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="room_number">Room number *</Label>
                <Input
                  id="room_number"
                  required
                  maxLength={10}
                  value={form.room_number}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, room_number: e.target.value }))
                  }
                  placeholder="101"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="room_type_id">Room type *</Label>
                <Select
                  required
                  value={form.room_type_id}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, room_type_id: v }))
                  }
                >
                  <SelectTrigger id="room_type_id">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {roomTypes.map((rt) => (
                      <SelectItem key={rt.id} value={rt.id}>
                        {rt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="capacity">Capacity *</Label>
                <Input
                  id="capacity"
                  type="number"
                  required
                  min={1}
                  value={form.capacity}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      capacity: parseInt(e.target.value, 10) || 1,
                    }))
                  }
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="price_night">Price / night (USD) *</Label>
                <Input
                  id="price_night"
                  type="number"
                  required
                  min={0.01}
                  step={0.01}
                  value={form.price_night}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      price_night: parseFloat(e.target.value) || 0,
                    }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="image_urls">
                Image URLs (up to 5, HTTPS, comma-separated)
              </Label>
              <Input
                id="image_urls"
                value={form.image_urls}
                onChange={(e) =>
                  setForm((f) => ({ ...f, image_urls: e.target.value }))
                }
                placeholder="https://example.com/img1.jpg, https://…"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="is_available"
                type="checkbox"
                checked={form.is_available}
                onChange={(e) =>
                  setForm((f) => ({ ...f, is_available: e.target.checked }))
                }
                className="h-4 w-4 rounded border-border"
              />
              <Label htmlFor="is_available" className="cursor-pointer">
                Mark as available
              </Label>
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="submit" size="sm" disabled={isMutating}>
                <Check className="mr-1.5 h-4 w-4" />
                {editingRoom ? "Save changes" : "Create room"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={resetForm}
                disabled={isMutating}
              >
                <X className="mr-1.5 h-4 w-4" />
                Cancel
              </Button>
            </div>
          </form>
        )}

        {/* ── Room list ─────────────────────────────────────────────────── */}
        {loading ? (
          <ul className="space-y-3" aria-busy="true" aria-label="Loading rooms">
            {Array.from({ length: 4 }).map((_, i) => (
              <li
                key={i}
                className="animate-pulse rounded-md border border-border/60 p-3"
              >
                <div className="mb-2 h-4 w-2/3 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted" />
              </li>
            ))}
          </ul>
        ) : rooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
            <Hotel className="h-8 w-8 opacity-50" aria-hidden="true" />
            <p className="text-sm">No rooms yet. Add the first one above.</p>
          </div>
        ) : (
          <ul className="space-y-3" aria-label="Rooms list">
            {rooms.map((room) => (
              <li
                key={room.room_id}
                className="flex items-start justify-between gap-3 rounded-md border border-border/60 p-3 dark:border-border"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium">
                    Room {room.room_number}
                    {room.room_type?.name && (
                      <span className="text-muted-foreground">
                        {" "}· {room.room_type.name}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatPrice(Number(room.price_night))}/night · Cap{" "}
                    {room.capacity}
                  </p>
                  {(room.image_urls?.length ?? 0) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {room.image_urls!.length} image
                      {room.image_urls!.length !== 1 ? "s" : ""}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <AvailabilityBadge available={room.is_available} />

                  {canManage && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label={`Edit room ${room.room_number}`}
                        onClick={() => openEdit(room)}
                        disabled={isMutating}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>

                      {deleteConfirmId === room.room_id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="destructive"
                            className="h-7 w-7"
                            aria-label="Confirm delete"
                            disabled={deleting}
                            onClick={() =>
                              void deleteRoom({
                                variables: { room_id: room.room_id },
                              })
                            }
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            aria-label="Cancel delete"
                            onClick={() => setDeleteConfirmId(null)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          aria-label={`Delete room ${room.room_number}`}
                          onClick={() => setDeleteConfirmId(room.room_id)}
                          disabled={isMutating}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
