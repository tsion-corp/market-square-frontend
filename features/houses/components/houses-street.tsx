"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { EmptyPanel, EmptyPanelAction } from "@/components/ui/empty-panel";
import { IconVoiceMode } from "@/components/ui/room-icons";
import { useGate } from "@/hooks/use-gate";
import { useQueryParam } from "@/hooks/use-query-param";
import { useStreamList } from "@/features/streams/hooks/use-streams";
import type { Stream } from "@/features/streams/lib/types";
import { OpenHouseSheet } from "@/features/houses/components/open-house-sheet";

/**
 * THE GIST ROOMS PAGE — node 1317:158073, the 2026-09-12 file. It is where
 * both of Home's "View more" pills (Top GistRooms, Coming Soon) land.
 *
 * A 951-wide artboard on the chrome's `#121214` with the rail's hairline at its
 * right — the column and the rail's width together, which is the shell's FULL
 * frame — inset 22 on the left, 21 on the right, 22 from the top:
 *
 *   · the search row (1317:158074, `HomeTopRow` — the same 48 row Home opens
 *     with, here drawn in the pill's open state);
 *   · 36 below it, "Live GistRooms" (1317:158104, Manrope Bold 24 / 28.61,
 *     "GistRooms" in the 90deg #C196FD → #7E3BEB fill) with NO "View more" —
 *     this is the page it would go to;
 *   · 16 below, the grid (1317:158083): rows 104 tall on a 16 gap, three
 *     cards across at 290.47 x 103.13 — the 338 x 120 invite card at 0.8594 —
 *     20 apart. The file draws six rows of the same card; this draws every
 *     live room the service returns;
 *   · 59 below the grid, "Coming Soon" (1317:158175, all white, no pill), 16,
 *     then the upcoming grid (1317:158179): rows 91 tall on a 16 gap, three
 *     cards across at 296.52 x 91 — the 479 x 147 upcoming card at 0.619 —
 *     12.38 apart.
 *
 * ─── WHAT THE OLDER PAGE HAD AND THIS ONE DOES NOT ───────────────────────────
 * 407:17074 opened with "Happening Now!", a topic row and a floating create
 * circle, and ran upcoming rooms sideways. None of those is in 1317:158073, so
 * none is drawn: no page heading, no `TopicTabs` (the page shows every room),
 * no circle (the sidebar's "Start Gistroom" and Home's banner are the ways
 * in), and Coming Soon is a grid. `?open=1` still opens the room composer on
 * arrival — that is the sidebar button's contract, not a drawing.
 *
 * ─── THE FRAME IS 4 NARROWER THAN THE ARTBOARD, AND THE FILE OVERFLOWS ITS
 * OWN ──────────────────────────────────────────────────────────────────────
 * The shell's FULL frame is 947 of usable width; the artboard is 951 and its
 * grids are 911 and 914 inside a 908 row (the third card's right edge sits at
 * 933 on a 930 row). So the cards keep their sizes and the COLUMNS spread to
 * the frame: the live cards are the file's fixed 290.47 with the two gaps
 * sharing what is left (15.8 here, the file's 20), and the upcoming cards keep
 * the file's 12.38 gap and scale from their width as they are built to (292.7
 * here, the file's 296.52). Every other number is the node's.
 *
 * The room card and the upcoming card are composed from OUTSIDE this slice
 * (they read the streams, discovery and messages slices), as are the search
 * row and the two headings (`components/layout`) — the route-slot pattern
 * every screen here uses.
 */
export function HousesStreet({
  headSlot,
  headingSlot,
  roomCardSlot,
  upcomingCardSlot,
  guestPickerSlot,
}: {
  /** The search row at the head of the page (1317:158074). */
  headSlot?: React.ReactNode;
  /** The two section headings (1317:158104 / 1317:158175). */
  headingSlot?: (section: "live" | "soon") => React.ReactNode;
  /** The invite card for one open room, at 415:12669's own scale. */
  roomCardSlot?: (stream: Stream) => React.ReactNode;
  /** The card for a room that has not opened yet (1295:140164). */
  upcomingCardSlot?: (stream: Stream) => React.ReactNode;
  /** Who may enter a private room opened from here — see `OpenHouseSheet`. */
  guestPickerSlot?: (args: {
    value: string[];
    onChange: (next: string[]) => void;
    max: number;
  }) => React.ReactNode;
} = {}) {
  const gate = useGate();
  const [opening, setOpening] = useState(false);

  /*
    `?open=1` OPENS THE SHEET ON ARRIVAL — the sidebar's "Start Gistroom" and
    Home's banner both land here with it. `useQueryParam`, never
    `useSearchParams` (its Suspense boundary delays hydration). Fired ONCE via
    a ref rather than on every render the param survives, so dismissing the
    sheet does not immediately reopen it while the URL still carries the flag.
  */
  const openParam = useQueryParam("open");
  const autoOpened = useRef(false);
  useEffect(() => {
    if (openParam !== "1" || autoOpened.current) return;
    autoOpened.current = true;
    gate(() => setOpening(true));
  }, [openParam, gate]);

  // Rooms, by KIND (`kind=room`), every topic: the page draws no topic row.
  const live = useStreamList("live", [], undefined, "room");
  const scheduled = useStreamList("scheduled", [], undefined, "room");
  const liveHouses = live.data?.items ?? [];
  const scheduledHouses = scheduled.data?.items ?? [];

  return (
    <div className="w-full pl-[22px] pr-[21px] pt-[22px]">
      {headSlot}

      {live.isPending ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-6 w-6 text-grey-600" />
        </div>
      ) : live.isError ? (
        <div className="px-4 py-8">
          <ErrorState
            error={live.error}
            fallback="Couldn't load the gist rooms."
            onRetry={() => live.refetch()}
          />
        </div>
      ) : liveHouses.length === 0 && scheduledHouses.length === 0 ? (
        /*
          THE DESIGNER'S EMPTY STATE — node 543:45867, named for this page.
          1317:158073 draws no empty picture of its own, and a page with no
          rooms on it has to say so somewhere. The action is "Start Gistroom",
          worded as the rail's button is, on the Join control's own waveform.
        */
        <div className="mt-9">
          <EmptyPanel
            title="No gist rooms open"
            body="A gist room is where people talk. Open one and name what it is about — anyone can walk in."
            action={
              <EmptyPanelAction
                onClick={() => gate(() => setOpening(true))}
                icon={<IconVoiceMode className="h-6 w-6" />}
              >
                Start Gistroom
              </EmptyPanelAction>
            }
          />
        </div>
      ) : (
        <>
          {liveHouses.length > 0 && (
            <section aria-labelledby="live-gistrooms" className="mt-9">
              {headingSlot?.("live")}
              {/* The card is node 1769:3670 at its NATURAL size now (see the
                  header): the old CSS `zoom` that fit it into a 290 cell broke
                  the mic badge's SVG gradient, so the card is rendered fluid in
                  an at-most-two-across grid instead. */}
              <div
                role="list"
                aria-label="Gist rooms open now"
                className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2"
              >
                {liveHouses.map((stream) => (
                  <div key={stream.id} role="listitem" className="min-w-0">
                    {roomCardSlot?.(stream)}
                  </div>
                ))}
              </div>
            </section>
          )}
          {scheduledHouses.length > 0 && (
            <section
              aria-labelledby="coming-soon-page"
              className={liveHouses.length > 0 ? "mt-[59px]" : "mt-9"}
            >
              {headingSlot?.("soon")}
              {/* The upcoming cards are the wide HORIZONTAL ComingSoonCard now
                  (node 1542:3294), so the grid is at most TWO across — a
                  three-column cell is far too narrow for a 467-wide card. */}
              <div
                role="list"
                aria-label="Gist rooms opening later"
                className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2"
              >
                {scheduledHouses.map((stream) => (
                  <div key={stream.id} role="listitem" className="min-w-0">
                    {upcomingCardSlot?.(stream)}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <OpenHouseSheet
        open={opening}
        onClose={() => setOpening(false)}
        guestPickerSlot={guestPickerSlot}
      />
    </div>
  );
}
