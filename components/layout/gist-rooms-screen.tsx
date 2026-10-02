"use client";

import { HousesStreet } from "@/features/houses";
import { GuestPicker } from "@/components/layout/guest-picker";
import { LiveRoomCard } from "@/features/streams/components/live-room-card";
import { ComingSoonCard } from "@/components/layout/coming-soon-card";
import { useState } from "react";
import { HomeTopRow } from "@/components/layout/home-top-row";
import { HomeSearch } from "@/components/layout/home-search";
import { SectionHeading } from "@/components/layout/section-heading";

/**
 * The gist rooms page, composed — node 1317:158073 (see `HousesStreet` for
 * the page's numbers).
 *
 * The street belongs to the houses slice; four things on it do not, so all
 * four arrive as slots — the same route-slot pattern `home-screen` and
 * `house-room-screen` use:
 *
 *  · THE SEARCH ROW is Home's `HomeTopRow` (1317:158074 is 1295:142736 again,
 *    908 wide with the pill open);
 *  · THE HEADINGS are `SectionHeading`, the one object Home repeats — here
 *    without its "View more", because this is the page that pill opens;
 *  · THE ROOM CARD is `LiveRoomCard` (node 2078:19217) — the SAME card Home's
 *    Top GistRooms rail draws, rendered `fluid` so it fills its grid cell
 *    rather than holding the rail's 342. It used to be `GistRoomCard`
 *    (1769:3670), which is the card a DM and a shared link draw, where a room
 *    is a REFERENCE to something mentioned elsewhere. This page and that rail
 *    are the same act — a list of rooms you can walk into — so they are one
 *    card, and ogazboiz asked for exactly that on 2026-09-23. Two cards for
 *    one act is how one of them ends up with the wrong topic chips;
 *  · THE UPCOMING CARD is `ComingSoonCard` — the wide horizontal card
 *    (node 1542:3294), the same one Home's Coming Soon rail draws, so the two
 *    surfaces cannot drift. It fills its grid cell, so the grid is at most two
 *    across (see HousesStreet).
 */
export function GistRoomsScreen() {
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const row = <HomeTopRow value={query} onChange={setQuery} />;

  // The column answers its own query — see the note in pals-screen. Returned
  // before HousesStreet rather than threaded through it: the street draws
  // rooms, and a search is not a shorter list of rooms.
  if (searching) {
    return (
      <div className="w-full pl-[22px] pr-[21px] pt-[22px]">
        {row}
        <div className="mt-6">
          <HomeSearch query={query} />
        </div>
      </div>
    );
  }

  return (
    <HousesStreet
      headSlot={row}
      /* The people a private room is private TO, when it was opened from the
         street rather than from a house. The directory is the discovery
         slice's, so it is composed here like every other cross-slice object. */
      guestPickerSlot={({ value, onChange, max }) => (
        <GuestPicker value={value} onChange={onChange} max={max} />
      )}
      headingSlot={(section) =>
        section === "live" ? (
          <SectionHeading id="live-gistrooms" lead="Live" accent="GistRooms" />
        ) : (
          <SectionHeading id="coming-soon-page" lead="Coming Soon" />
        )
      }
      roomCardSlot={(stream) => <LiveRoomCard fluid stream={stream} />}
      upcomingCardSlot={(stream) => <ComingSoonCard stream={stream} />}
    />
  );
}
