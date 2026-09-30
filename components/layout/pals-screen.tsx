"use client";

import { useMemo, useState } from "react";
import { HomeTopRow } from "@/components/layout/home-top-row";
import { HomeSearch } from "@/components/layout/home-search";
import { PalsInRooms } from "@/components/layout/pals-in-rooms";
import { usePostSlots } from "@/components/layout/home-screen";
import { FeedPage, StoriesRow, TopicTabs, type TopicTab } from "@/features/feed";
import { useTopics } from "@/features/discovery";
import { useAuth } from "@/hooks/use-auth";

/** The unfiltered lane — one reference, so the feed's query key is stable. */
const NO_TOPICS: readonly string[] = [];

/**
 * THE PALS SURFACE — node 1328:1885 (in the 1440 page 1328:1882): your
 * friends and what they are interested in.
 *
 * The node is a 951-wide artboard on the chrome's own `#121214`, but its page
 * (1328:1882) draws the RAIL inside it at x=618 (1328:6093: Citizen
 * Spotlight, Explore Categories, Suggested Curators — `RightRail`), so this is
 * the shell's ordinary 600 column with the rail beside it, NOT a FULL route;
 * it was one until 2026-09-12 ("the side bar at the right hand is not
 * showing why in pal"). Everything the column draws is in that left 618
 * (1331:21792), top to bottom:
 *
 *   · the SEARCH ROW (1331:21793) at (13, 12), 574 x 48 — the same field and
 *     settings pill Home's column opens on (1295:142736), number for number:
 *     `HomeTopRow`, unchanged;
 *   · the STORIES (1331:21802) at (13, 111), 596 x 96 — "Your Story" then the
 *     strip on a 12, the tiles on a 5.45 — the feed slice's `StoriesRow`,
 *     which is who you follow and so exists only for a signed-in reader;
 *   · the TOPIC ROW (647:16266) — not in this node, but asked for here by
 *     ogazboiz on 2026-09-12 ("put that topic rail tabs since feeds are
 *     here"). It is Home's old row over the same shared vocabulary, `GET
 *     /topics?surface=home`, and its selection narrows the lane below
 *     through `GET /feed?topics=`. `/topics` is the discovery slice's and
 *     `/feed` is the feed's, and this is the one layer allowed to know both,
 *     so the selection lives here and goes down as a prop;
 *   · the FEED (1344:21876) — post cards 573.14 wide on a 47.89 gap, every
 *     author in the "Following" state: the FOLLOWING lane, which `FeedPage`
 *     draws in its `pals` mode.
 *
 * WHAT THE NODE DRAWS AND THIS PAGE DOES NOT: the wink deck and "Make some
 * friends" (1331:21321, 1344:21868) between the stories and the list. It is
 * the same `FriendsDeck` Home already renders, and ogazboiz asked for it to
 * be hidden here on 2026-09-12 — "the second section is already on home so
 * no need for that again". Nothing else either: no banner, no rooms, no
 * houses, no suggested pals.
 *
 * "For you" stays the row's first pill: it is the file's own pill, with the
 * file's wink on it, and it means the lane unnarrowed — here, everyone you
 * follow — the same way it did over Home's lane.
 *
 * 1331:21318 is the node's own edge: a 33-wide strip at x=589, 4190 tall from
 * y=68, `#121214` fading from opaque at its foot to nothing at its head — the
 * column's right edge crossing the rail's hairline by 4. The shell draws
 * nothing like it, so it is drawn here on the same relation to this column's
 * edge, from lg where the rail is, and capped to the page so it never scrolls
 * past it.
 */
export function PalsScreen() {
  const postSlots = usePostSlots();
  // The strip is who you follow, so it exists only for someone signed in —
  // the same gate Home put on it.
  const { authenticated } = useAuth();
  // Home's own eight, in the design's order (`?surface=home`) — the row
  // renders what the service serves, nothing hard-coded.
  const vocabulary = useTopics("home");
  const [topic, setTopic] = useState<string | null>(null);
  const tabs: TopicTab[] = useMemo(
    () => [
      { key: null, label: "For you" },
      ...(vocabulary.data ?? []).map((entry) => ({ key: entry.key, label: entry.label })),
    ],
    [vocabulary.data]
  );
  const topics = useMemo(() => (topic ? [topic] : NO_TOPICS), [topic]);
  /*
    THE FIELD ANSWERS HERE TOO.

    It used to be a link into Explore on every page but Home, which meant
    searching from /pals threw you off /pals (ogazboiz: "why is the pal search
    taking me to /discovery"). Each column owns its OWN query — they are
    separate pages and never on screen together, so there is no shared string
    for two inputs to fight over.
  */
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  return (
    <div className="relative">
      <FeedPage
        mode="pals"
        topics={topics}
        {...postSlots}
        searchSlot={searching ? <HomeSearch query={query} /> : undefined}
        headSlot={
          <>
            {/* 1331:21793 — 574 wide at the node's 13. */}
            <div className="md:ml-[13px] md:w-[574px]">
              <HomeTopRow value={query} onChange={setQuery} />
            </div>
            {/* 1331:21802 — from the same 13. The node steps 51 under the row
                (60 -> 111), and this page walks 28 instead: the node draws the
                stories DIRECTLY under the search row, and the head now carries
                a rooms rail between them, so three 51s stacked read as a hole
                rather than as rhythm (ogazboiz: "too many space below the
                search bar and status"). The whitespace around a frame is ours
                — see CLAUDE.md; the CONTENT box is the file's.
                The node's strip is 596 wide and its overlay clips it at 618;
                the 600 column clips it at its own edge and the strip scrolls. */}
            {/* YOUR PEOPLE, RIGHT NOW — above everything they have posted.
                A people page leads with who is around, not with what they
                wrote earlier. It renders NOTHING when nobody is in a room,
                which on a young graph is most of the time, so the rows below
                must read as complete without it. */}
            {/* No margin on the wrapper: the rail is empty most of the time,
                and a wrapper that keeps its gap when its child renders nothing
                leaves a hole under the search row. The section carries its
                own 51 — see pals-in-rooms.tsx. */}
            {!searching && authenticated && (
              <div className="md:ml-[13px] md:w-[calc(100%-13px)]">
                <PalsInRooms />
              </div>
            )}
            {/* NO "YOUR PALS" LIST HERE ANY MORE.

                It was a client-side intersection of following and followers,
                built before the service had a pals lane. It does now, and the
                FEED below is already scoped to mutual follows server-side — so
                the list was answering a question the page had already answered,
                one section further down (ogazboiz: "your pals section ...
                should not be able to show").

                What is left is the part a timeline cannot say: who is in a room
                right now, above. */}
            {!searching && authenticated && (
              <div className="mt-[28px] md:ml-[13px] md:w-[calc(100%-13px)]">
                <StoriesRow />
              </div>
            )}
            {/* 647:16266 — the topic row, on the column's own 51 under the
                strip (or under the search row, signed out), as wide as the
                stories so its rule ends where they do. */}
            {!searching && (
              <div className="mt-[28px] md:ml-[13px] md:w-[calc(100%-13px)]">
                <TopicTabs tabs={tabs} active={topic} onSelect={setTopic} />
              </div>
            )}
          </>
        }
      />
      {/* 1331:21318 sits at x=589 on the node's 618 column, i.e. its 33 cross
          the rail's hairline by 4. Anchored to THIS column's edge the same
          way (600 - 29 = 571), rather than at a literal 589 that would hang
          22 into the rail. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-1 top-[68px] hidden h-[4190px] max-h-[calc(100%-68px)] w-[33px] bg-[linear-gradient(to_top,#121214_0%,rgba(18,18,20,0)_100%)] lg:block"
      />
    </div>
  );
}
