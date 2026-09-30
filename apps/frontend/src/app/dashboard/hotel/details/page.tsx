"use client";

import { useState } from "react";
import { useQuery } from "@apollo/client";
import Header from "@/components/layouts/Header";
import { SideBar } from "@/components/layouts/SideBar";
import Gallery from "@/components/hotels/details/Gallery";
import Information from "@/components/hotels/details/Information";
import Details from "@/components/hotels/details/Details";
import HotelMap from "@/components/hotels/payment/Map";
import { RoomsTab } from "@/components/dashboard/hotel/RoomsTab";
import { GET_ROOM_TYPES } from "@/graphql/queries/hotel-queries";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type RoomType = { id: string; name: string };

// ── Tabs ──────────────────────────────────────────────────────────────────────

type TabId = "overview" | "rooms";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "rooms", label: "Rooms" },
];

// ─────────────────────────────────────────────────────────────────────────────
// NOTE: hotelId is currently hardcoded to the static demo hotel.
// Replace with a dynamic param (e.g. useSearchParams / useParams) once the
// public hotel route is re-enabled.
// ─────────────────────────────────────────────────────────────────────────────
const DEMO_HOTEL_ID = process.env.NEXT_PUBLIC_DEMO_HOTEL_ID ?? "";

export default function HotelPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const images = [
    "/img/room1.png",
    "/img/room2.png",
    "/img/room2.png",
    "/img/room2.png",
  ];

  const coordinates: [number, number] = [9.9333, -84.0833];

  // Fetch room types for the Rooms tab create/edit form
  const { data: roomTypesData } = useQuery<{ room_types: RoomType[] }>(
    GET_ROOM_TYPES,
  );
  const roomTypes = roomTypesData?.room_types ?? [];

  return (
    <div className="bg-gray-100 min-h-screen dark:bg-dark-background text-black dark:text-white text-sm">
      <Header />
      <div className="flex flex-col lg:flex-row mt-8">
        <SideBar className="hidden md:block" notificationCount={2} />
        <div className="flex-grow p-4 flex flex-col items-center gap-6">
          <div className="w-full md:w-2/3">
            <Gallery images={images} />
          </div>

          <div className="w-full md:w-2/3 flex flex-wrap">
            <div className="w-full md:w-3/4 lg:w-3/4">
              <Information
                name="Shikara Hotel"
                location="329 Calle Santos, Paseo Colón, San José, Costa Rica"
                price="$40.18"
              />
            </div>
            <div className="hidden md:block md:w-1/4 lg:w-1/4"></div>
          </div>

          {/* ── Tab bar ───────────────────────────────────────────────── */}
          <div className="w-full md:w-2/3">
            <div
              role="tablist"
              aria-label="Hotel sections"
              className="flex border-b border-border"
            >
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls={`panel-${tab.id}`}
                  id={`tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    activeTab === tab.id
                      ? "border-b-2 border-primary text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Tab panels ───────────────────────────────────────────── */}
          <div className="w-full md:w-2/3">
            {/* Overview panel */}
            <div
              role="tabpanel"
              id="panel-overview"
              aria-labelledby="tab-overview"
              hidden={activeTab !== "overview"}
            >
              <div className="flex flex-wrap gap-4">
                <div className="w-full md:w-3/4 lg:w-3/4 flex gap-4">
                  <div className="w-full md:w-1/2 min-h-[250px]">
                    <Details
                      beds={2}
                      baths={1}
                      description="Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled it to make a type specimen book."
                    />
                  </div>
                  <div className="w-full md:w-1/2 min-h-[250px]">
                    <HotelMap
                      coordinates={coordinates}
                      hotelName="Shikara Hotel"
                    />
                  </div>
                </div>
                <div className="hidden md:block md:w-1/4 lg:w-1/4"></div>
              </div>
            </div>

            {/* Rooms panel */}
            <div
              role="tabpanel"
              id="panel-rooms"
              aria-labelledby="tab-rooms"
              hidden={activeTab !== "rooms"}
            >
              <RoomsTab
                hotelId={DEMO_HOTEL_ID}
                roomTypes={roomTypes}
                // canManage is true for host/admin — wire up from auth context
                // once the route supports dynamic hotel ownership checks.
                canManage={true}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
