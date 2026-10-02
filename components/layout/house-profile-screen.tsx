"use client";

import { isHttpUrl } from "@/lib/http-url";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HouseMemberTile } from "@/components/layout/house-member-tile";
import { EmptyState } from "@/components/ui/states";
import { useHouse, useHouseMembers, useHouseReplays } from "@/features/messages/lib/house";
import { useTopics } from "@/features/discovery";
import { PostText } from "@/components/ui/post-text";
import { Avatar } from "@/components/ui/avatar";
import { useJoinGroup } from "@/features/messages";
import { useLeaveGroup } from "@/features/messages/hooks/use-messages";
import { useMe } from "@/hooks/use-me";
import { ShareSheet } from "@/components/ui/share-sheet";
import {
  HouseMenu,
  IconMenuDots,
  IconMenuFlag,
  IconMenuLeave,
  IconMenuPeople,
  IconMenuShare,
} from "@/components/layout/house-menu";
import { asset, sq } from "@/lib/square-path";
import { cn } from "@/lib/cn";
import { shortDateLabel } from "@/lib/format";

/**
 * A HOUSE'S OWN PAGE — nodes 1285:36373 and 1285:36895 (SQUARE 2.0 Copy).
 *
 * The two nodes are ONE page in two states, and the only difference between
 * them is the button: "Join House" for somebody outside it, "View House" for a
 * member. That is `viewerIsMember` off the house read, so the page is built
 * once and the service decides which of the two it is.
 *
 * It is a ROUTE, not a sheet (ogazboiz, 2026-09-23: "just like the way normal
 * person avatar is taking me to his own profile"). Tapping a house anywhere
 * goes to /houses/<id>, the way tapping a face goes to /u/<username> — the
 * preview sheet answered a tap with a modal, which is a different gesture with
 * a different meaning and no address you can send anyone.
 *
 * ─── WHAT THE FILE DRAWS THAT IS NOT HERE, AND WHY IT IS NOT STUBBED ─────────
 * The design also carries a website, a location, a "gistrooms/week" figure and
 * a Replays rail, and the service has a field for none of them. Members DOES
 * render, off `GET /conversations/:id/members` — but that route is bearerAuth,
 * so a signed-out reader and a stranger to a private house see no row at all,
 * while the design draws it in the NON-MEMBER state. The fix is a capped
 * roster on the house read itself; the backend has taken it, public houses
 * only, because a private house deliberately never enumerates who is inside.
 *
 * Replays needs a `houseConversationId` filter on `GET /streams` — taken too.
 * The weekly figure turned out to be a REAL CAP a house sets rather than
 * design filler, so it is a feature being built and NOT a number to draw until
 * the service enforces it.
 *
 * So those sections are ABSENT rather than empty. A shelf captioned "Members"
 * with nothing on it tells a reader the house has no members, which is a
 * claim, and a false one. Each gap is with the backend and each lands here as
 * it ships.
 *
 * ─── THE FILE'S ROBOTO IS GEIST HERE ─────────────────────────────────────────
 * The node sets the house name, "Back" and the section headings in Roboto.
 * `app/layout.tsx` names the two surfaces whose design genuinely is Roboto and
 * says nothing else may reach for it, so this uses the product's own face.
 */
export function HouseProfileScreen({ id }: { id: string }) {
  const router = useRouter();
  const house = useHouse(id);
  const join = useJoinGroup();
  /*
    ONE ROSTER, TWO SOURCES, AND THE HOUSE READ WINS.

    The house read carries a capped roster for a PUBLIC house — including to a
    signed-out stranger, which is the state the design is built around. The
    members route is bearerAuth and serves a member of a PRIVATE house, which
    the house read deliberately will not. So the first is preferred and the
    second fills in, and neither is asked to cover the other's case.

    An empty array is NOT "no members": a private house answers `[]` to
    everyone outside it. `memberCount` is the true total and is unaffected,
    which is why the count in the hero does not go through this at all.
  */
  const fromHouse = house.data?.members ?? [];
  const replays = useHouseReplays(id, Boolean(house.data));
  // The replay card wears the room's topics as chips; the labels come from the
  // shared vocabulary rather than being title-cased off the key.
  const topics = useTopics();
  /*
    THE MEMBERS ROUTE WINS FOR A MEMBER, AND IT IS ABOUT THE FOLLOW EDGE.

    The house read's roster is `.map(toSummary)` with NO follow hydration
    (service `conversation-service.ts`, the `showRoster` branch), while
    `listMembers` calls `hydrateFollowState` explicitly. So a tile built from
    the house read carries no `isFollowing`, and `useIsFollowing` correctly
    refuses to invent one — which renders "Follow" over somebody the reader
    already follows. ogazboiz reported exactly that.

    It is also the only COMPLETE list: the house read caps its roster at
    `MEMBERS_ON_A_ROW = 4`, a constant written for the inbox's avatar stack
    ("you, Ada and 4 others"), while this house has 246 members.

    So: ask the route whenever it can answer — the reader is a member, or the
    capped roster came back empty — and prefer its answer. The capped roster
    stays as the fallback for the state the route cannot serve at all, a
    SIGNED-OUT or non-member reader of a public house, which is the state the
    design is drawn in. Neither is asked to cover the other's case.
  */
  const viewerIsMember = house.data?.viewerIsMember === true;
  const membersQuery = useHouseMembers(
    id,
    Boolean(house.data) && (viewerIsMember || fromHouse.length === 0),
  );
  const fromRoute = membersQuery.data ?? [];
  const roster =
    fromRoute.length > 0 ? fromRoute : fromHouse.map((profile) => ({ profile }));
  /*
    FIVE TILES THEN THE CONTROL — `Frame 2147225670` draws exactly five
    members and a sixth cell that is "View all". It was twelve here, a number
    from nowhere in the file.
  */
  const MEMBERS_ON_THE_ROW = 5;
  const [showAllMembers, setShowAllMembers] = useState(false);
  const shownMembers = showAllMembers ? roster : roster.slice(0, MEMBERS_ON_THE_ROW);
  /*
    The service's own total, which is NOT capped — `memberCount` is computed
    from the full participant list even where the roster beside it is trimmed
    to four. Falling back to the list's length keeps the control honest for a
    house whose count did not come back rather than inventing one.
  */
  const memberTotal = house.data?.memberCount ?? null;
  const hiddenMembers = showAllMembers
    ? 0
    : Math.max(0, (memberTotal ?? roster.length) - shownMembers.length);
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const leave = useLeaveGroup(id);
  const me = useMe();

  if (house.missing) {
    return (
      <div className="px-4 py-10">
        <EmptyState
          title="This house isn't here"
          body="It may have been removed, or it may be private."
        />
      </div>
    );
  }

  const data = house.data;
  const title = data?.title ?? "House";
  const members = data?.memberCount ?? null;

  /*
    THE COLUMN'S OWN INSET. The node puts the page column at x=112 and the
    cover at x=144 — 32 between them — so the cover never touches the rule that
    separates this column from the rail beside it (ogazboiz, 2026-09-23: "no
    space in the left hand side touching the border line"). Built edge to edge
    it read as a bleed nobody asked for.
  */
  return (
    <div className="mx-auto w-full max-w-[773px] px-4 pb-16 pt-6 md:px-8">
      {/*
        `Caver` — 741 x 473 at a 20 radius, the house picture full-bleed with a
        scrim at each end: 108 down from the top so Back stays readable, and
        215 up from the bottom so the name does. Both are the file's own.
      */}
      {/*
        THE COVER CLIPS, THE CARD DOES NOT.

        This was one box with `overflow-hidden` so the picture would take the
        20 radius — and the overflow menu lives inside it, so the menu was
        clipped to the banner and disappeared into the photograph (ogazboiz,
        2026-09-23: "the dropdown is hiding inside the background profile
        picture"). A menu that opens downward from a control near the bottom
        edge has nowhere to go inside its own parent.

        So the clip moved INWARD: the picture and its scrims sit in their own
        rounded, clipping layer, and everything that has to escape — the menu —
        sits in the outer box, which does not clip.
      */}
      <div className="relative aspect-[741/473] w-full rounded-[20px] bg-[#101012]">
        <div className="absolute inset-0 overflow-hidden rounded-[20px]">
          {data?.imageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- media hosts are unknown at build time */
            <img
              src={data.imageUrl}
              alt=""
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <div
              aria-hidden
              className="absolute inset-0 bg-[linear-gradient(160deg,#241640_0%,#101012_70%)]"
            />
          )}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-[23%]"
            style={{
              background:
                "linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0))",
            }}
          />
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-[46%]"
            style={{
              background:
                "linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0))",
            }}
          />
        </div>

        {/* `Frame 1000002771` — 24 in and 24 down, a 20 glyph and the label 8 away. */}
        <button
          type="button"
          onClick={() => router.back()}
          className="ws-press absolute left-6 top-6 flex items-center gap-2 text-[16px] leading-6 text-white"
        >
          <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none">
            <path
              d="M12.5 4.5 7 10l5.5 5.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back
        </button>

        {/* `Frame 2147230511` — the name over the count, on the cover. */}
        <div className="absolute inset-x-6 bottom-6 flex items-end justify-between gap-4">
          {/*
            NO AVATAR BESIDE THE NAME, and that is a departure with a reason.
            The node draws a 72 picture next to the title because its cover is
            a DIFFERENT image — a photograph behind, the house's own mark in
            front. A house here has exactly one `imageUrl`, so reproducing the
            node means printing the same picture twice, a few pixels apart
            (ogazboiz, 2026-09-23: "the background banner image we are using it
            has the image already"). The banner is the picture; the name sits
            on it.
          */}
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex min-w-0 flex-col gap-2">
              <h1 className="truncate text-[24px] font-bold leading-8 text-white">
                {title}
              </h1>
              {/* Never "0 members": a null count means the payload does not
                  count them, which is a different claim. */}
              {members !== null && (
                <p className="flex items-baseline gap-1 text-[15px] leading-5">
                  <span className="tnum font-semibold text-[#F7F9F9]">
                    {members.toLocaleString()}
                  </span>
                  <span className="text-white">
                    {members === 1 ? "member" : "members"}
                  </span>
                </p>
              )}
            </div>
          </div>

          {/* `Frame` at 700,494 — the action and its overflow, 16 apart. The
              node draws TWO states of one button and the service decides
              which: a member views, everybody else joins. */}
          {/* `Frame` at 700,494 — the action and its overflow, 16 apart, both
              at a full radius; the trigger is the file's own 38 square. */}
          <div className="relative flex shrink-0 items-center gap-4">
            {data?.viewerIsMember ? (
              <a
                href={sq(`/messages?c=${id}`)}
                className="ws-btn-welcome ws-btn-sm ws-press flex items-center justify-center whitespace-nowrap rounded-full font-medium text-white"
              >
                View House
              </a>
            ) : (
              <button
                type="button"
                disabled={!data?.canJoin || join.isPending}
                title={
                  data && !data.canJoin
                    ? "This house isn't open to join"
                    : undefined
                }
                onClick={() => join.mutate(id)}
                className="ws-btn-welcome ws-btn-sm ws-press flex items-center justify-center whitespace-nowrap rounded-full font-medium text-white disabled:opacity-40"
              >
                Join House
              </button>
            )}

            <button
              type="button"
              aria-label="More about this house"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="ws-press grid size-[38px] shrink-0 place-items-center rounded-full bg-white/10 text-[#F4F4F4] transition-colors hover:bg-white/20"
            >
              {IconMenuDots}
            </button>
            {menuOpen && (
              <HouseMenu
                onClose={() => setMenuOpen(false)}
                items={[
                  {
                    key: "share",
                    label: "Share group link",
                    icon: IconMenuShare,
                    onSelect: () => setSharing(true),
                  },
                  {
                    key: "members",
                    label: "View members",
                    icon: IconMenuPeople,
                    // The roster is on this page; the menu takes you to it
                    // rather than opening a second surface showing the same
                    // thing. Disabled when there is no roster to be taken to.
                    onSelect: () =>
                      document
                        .getElementById("house-members")
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        }),
                    disabledReason:
                      roster.length > 0
                        ? undefined
                        : "Nobody to show here yet.",
                  },
                  {
                    key: "report",
                    label: "Report",
                    icon: IconMenuFlag,
                    // `reportTarget` takes post | comment | profile |
                    // stream_message. A house is none of them, so this would
                    // either invent a type the service rejects or report
                    // nothing at all. Asked for; drawn and refused until then.
                    disabledReason: "Reporting a house isn't available yet.",
                  },
                  ...(data?.viewerIsMember
                    ? [
                        {
                          key: "leave",
                          label: "Leave house",
                          icon: IconMenuLeave,
                          destructive: true,
                          disabledReason: me.data?.id
                            ? undefined
                            : "Still loading your account.",
                          // Leaving is removing YOURSELF — the same route an
                          // owner uses to remove anybody, so it needs the
                          // reader's own id and is absent without one.
                          onSelect: () => {
                            if (me.data?.id) leave.mutate(me.data.id);
                          },
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </div>
        </div>
      </div>

      {/* `Frame 2147230547` — the body, 24 between its blocks. */}
      <div className="flex flex-col gap-6 pt-6">
        {data?.description && (
          /*
            A `div`, NOT a `p` — `PostText` renders its own block element.

            This was a paragraph wrapping a component that returns a
            paragraph, which is invalid and a hydration error. It was also
            silently breaking the clamp: a browser CLOSES the outer `<p>` when
            it meets the inner one, so `line-clamp-6` was landing on an empty
            element and the description, the renderer's paragraph and the
            "Read more" button all ended up as siblings after it. Nothing was
            ever clamped, and the button it pairs with had nothing to reveal.

            As a `div` the clamp applies to the box that actually holds the
            text, which is what it was written to do.
          */
          <div
            className={cn(
              // `whitespace-pre-line` is the whole of "they can format their
              // bio": the textarea has always accepted newlines and the column
              // has always stored them — the renderer was collapsing them into
              // one paragraph, so every house description read as a wall
              // whatever its owner typed.
              "whitespace-pre-line text-[15px] leading-5 text-[#F7F9F9]",
              !expanded && "line-clamp-6",
            )}
          >
            {/*
              The SAME renderer a post's body and a DM use, so an @mention in a
              house bio behaves exactly as it does everywhere else — one
              component, not a third one written for this surface. Inert until
              the service ships `descriptionMentions`, and plain text with its
              line breaks until then.
            */}
            <PostText text={data.description} mentions={data.descriptionMentions} />{" "}
            {!expanded && data.description.length > 260 && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="ws-press font-medium text-accent"
              >
                Read more
              </button>
            )}
          </div>
        )}

        {house.isPending && (
          <div
            aria-hidden
            className="h-5 w-40 animate-pulse rounded bg-white/10"
          />
        )}

        {/*
          `Frame 2147230544` — Members: the heading, then 104-wide tiles 24
          apart, each a 104 x 113 picture at a 32 radius with the name 8 under
          it. The row is ABSENT rather than empty when the roster cannot be
          read: "we may not see who is in here" and "nobody is in here" are
          different things and must not look the same.
        */}
        {/*
          `Frame 2147230507` — the stats line. Each half is absent unless the
          service sent it: `weeklyRoomLimit` is null for every house today and
          null means UNCAPPED, so there is no number and no default to invent.

          "IN THE LAST 7 DAYS", NOT "THIS WEEK". The service counts on a
          ROLLING seven-day window — it stores no timezone for anybody, so a
          calendar week cannot be honest, and "this week" promises a Monday
          reset that does not exist.
        */}
        {data?.weeklyRoomLimit != null && (
          <p className="flex items-baseline gap-1 text-[15px] leading-5 text-white">
            <span>Up to</span>
            <span className="tnum font-semibold text-[#F7F9F9]">
              {data.weeklyRoomLimit}
            </span>
            <span>gist rooms in any 7 days</span>
          </p>
        )}

        {/*
          `Frame 2147230510` — the link, its chain glyph in the accent.

          THE COMMENT THAT STOOD HERE SAID THE SERVICE ALREADY GUARANTEED THIS,
          AND IT DID NOT. It read: "the service allows http(s) only and refuses
          anything else at its own boundary, so this renders whatever it sent
          without re-judging it." The service's scheme check is real, is tested,
          and is sitting unmerged — so in production today this field accepts
          `javascript:…`, and the only thing between a stranger's house page and
          script running in a visitor's session was a sentence describing a
          guard that had not shipped.

          A house's `website` is user-set and renders as an ANCHOR, which is the
          one shape where a `javascript:` URL actually executes — an `<img src>`
          has not run one since the IE era, and most of the fields in this
          family are image sources and were never a vector. This is the field
          that matters, and it is checked HERE now.

          It stays checked after the service's own fix lands. Two guards is not
          duplication when one of them is a network away: this is the layer that
          cannot be wrong about which version of the service it is talking to.
        */}
        {isHttpUrl(data?.website) && (
          <a
            href={data.website}
            target="_blank"
            rel="noreferrer nofollow"
            className="ws-press flex w-fit items-center gap-2 text-[15px] leading-5 text-white underline-offset-4 hover:underline"
          >
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              className="size-5 text-accent"
              fill="none"
            >
              <path
                d="M8.5 11.5a3 3 0 0 0 4.24 0l2.4-2.4a3 3 0 1 0-4.24-4.25l-1 1"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path
                d="M11.5 8.5a3 3 0 0 0-4.24 0l-2.4 2.4a3 3 0 1 0 4.24 4.25l1-1"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            {data.website.replace(/^https?:\/\//, "")}
          </a>
        )}

        {/*
          MEMBERS FIRST, REPLAYS LAST — the file's own order (1285:36895:
          "Members" at y=44151, "Replays" at y=44364, and 1285:36373 agrees).

          I had them the other way round. It reads wrong as well as being
          wrong: a house is its people, and its past rooms are what those
          people did. Leading with the archive puts the record of a
          conversation above the conversation's participants.
        */}
        {roster.length > 0 && (
          <section
            id="house-members"
            className="flex flex-col gap-4 scroll-mt-24"
          >
            <h2 className="text-[12px] font-bold leading-4 text-[#F4F4F4]">
              Members
            </h2>
            {/* `Frame 2147225670` — the tiles 24 apart, centred on each other,
                and the rail clips rather than wraps: the file draws one row. */}
            <ul
              className={cn(
                "flex items-center gap-6 pb-1",
                // Expanded, the row becomes the grid the design's single row
                // cannot be: 246 members do not fit on one line at any width.
                showAllMembers
                  ? "flex-wrap"
                  : "overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              )}
            >
              {shownMembers.map((member) => (
                <HouseMemberTile
                  key={member.profile.id}
                  profile={member.profile}
                />
              ))}
              {/*
                `Frame 2147225673` — View all: a 48 disc over its label, both
                centred in a 104 x 113 cell so it sits on the tiles' photos
                rather than their names.

                IT IS GATED ON THE TRUE TOTAL, NOT ON THE LIST WE HOLD.

                It was `roster.length > 12`, and the house read caps its roster
                at four — so on a 246-member house the control could never
                appear, which is what ogazboiz hit. `memberCount` is the
                service's own total and is not capped, so it is the only number
                that can answer "is there more than this row shows".

                `hiddenMembers` falls back to the list's own length for a house
                whose count did not come back, and a house with nothing hidden
                still draws no control — a "View all" over everything there is
                would be a link to the same thing.
              */}
              {hiddenMembers > 0 && (
                <li className="flex h-[113px] w-[104px] shrink-0 flex-col items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAllMembers(true)}
                    className="ws-press grid size-12 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
                    aria-label={`View all ${memberTotal ?? roster.length} members`}
                  >
                    {/* `Button` 24 at white/10 INSIDE the 48 — the design
                        nests two discs, so the inner one reads a step lighter
                        than the outer rather than being one flat circle. */}
                    <span className="grid size-6 place-items-center rounded-full bg-white/10">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={asset("/icons/house-members/people.svg")}
                        alt=""
                        aria-hidden
                        className="h-3 w-3"
                      />
                    </span>
                  </button>
                  {/* 14/16.5 at white 50% — the file's own opacity, not a
                      muted token that happens to look similar. */}
                  <span className="text-[14px] leading-[16.5px] text-white/50">
                    View all
                  </span>
                </li>
              )}
            </ul>
          </section>
        )}

        {/*
          `Frame 2147230546` — Replays: the heading, then 359 x 120 cards 16
          apart at a 22 radius. Each is a 24 mic disc beside a 2-line title,
          its topic chips and the date under it, and the room's own faces at
          the right with a +N for the rest.

          THE CONTROL IS DEAD AND SAYS SO. The file draws "Play now"; nothing
          records a gist room, because the media server runs the SFU alone with
          no egress, so `replayUrl` is null on every room that has ever ended
          here. A live-looking Play on a card that cannot play is the same
          promise the post card refuses to make. It becomes Play the day a room
          carries a `replayUrl` — the field is already on `Stream`.

          Absent when there is nothing: a house that has never opened a room
          shows no Replays heading rather than an empty shelf under one.
        */}
        {replays.items.length > 0 && (
          <section className="flex flex-col gap-4">
            <h2 className="text-[12px] font-bold leading-4 text-[#F4F4F4]">Replays</h2>
            <ul className="flex gap-4 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {replays.items.map((room) => (
                <li
                  key={room.id}
                  /*
                    `Component 22` — 359 x 120 at a 22 radius, and it is the
                    same GLASS the rest of this file is made of: #101012 at
                    62% over a 14 background blur, ringed by a 1px INSIDE
                    stroke at white/18. I had drawn a flat #101012 slab with
                    no ring, which is the fourth time today the same omission
                    has cost a card its material.
                  */
                  className="flex h-[120px] w-[359px] shrink-0 items-center gap-4 rounded-[22px] bg-[rgba(16,16,18,0.62)] px-[27px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] backdrop-blur-[14px]"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-start gap-2">
                      {/* `Frame 2147230443` — the 24 mic disc on the create ramp. */}
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[linear-gradient(180deg,#9f65fd_0%,#5b05e6_100%)]">
                        <svg aria-hidden viewBox="0 0 16 16" className="size-3 text-white" fill="none">
                          <rect x="6" y="2.2" width="4" height="7.2" rx="2" fill="currentColor" />
                          <path d="M4 7.4a4 4 0 0 0 8 0M8 11.4v2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        </svg>
                      </span>
                      <p className="line-clamp-2 min-w-0 text-[12px] font-semibold leading-4 text-white">
                        {room.title}
                      </p>
                    </div>

                    {/*
                      THE ROOM'S TOPICS — `Frame 2147225009` and `2147225006`,
                      white/10 pills carrying Figma's GLASS, 12.3 tall with the
                      file's own 3.16/3.79 padding. I had left them out
                      entirely, which is why the card read as a bare line of
                      text where the file has a row of tags.
                    */}
                    {(room.topics ?? []).length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 pl-8">
                        {(room.topics ?? []).slice(0, 2).map((key) => (
                          <span
                            key={key}
                            className="inline-flex items-center rounded-full bg-white/10 px-[3.8px] py-[3.2px] text-[8px] font-medium leading-[10.4px] text-white backdrop-blur-[2px]"
                          >
                            {topics.data?.find((entry) => entry.key === key)?.label ?? key}
                          </span>
                        ))}
                      </div>
                    )}

                    {/*
                      `Frame 2147230546` — the action and the date, 8 apart.

                      The file's pill says "Play now" on the create ramp. It is
                      DEAD here and says Ended, for the reason ogazboiz gave on
                      the post card: nothing records a gist room yet, so a
                      live-looking Play is a promise the product does not keep.
                      The SHAPE is the file's — 73 x 22 at a 30 radius — so it
                      becomes Play the day `replayUrl` carries something, with
                      only the words and the disabled flag to change.
                    */}
                    <div className="flex items-center gap-2 pl-8">
                      <button
                        type="button"
                        disabled
                        title="This gist room has ended. Recordings aren't available yet."
                        className="inline-flex h-[22px] cursor-not-allowed items-center gap-[3px] rounded-[30px] bg-white/10 px-3 py-[5px] text-[10px] font-medium leading-4 text-white/50"
                      >
                        Ended
                      </button>
                      {room.endedAt && (
                        <span className="text-[10px] font-medium leading-4 text-white">
                          {shortDateLabel(room.endedAt)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/*
                    `Group 1000002783` — WHO WAS IN THE ROOM.

                    Up to three 32px plates at a 10.67 radius, each with the
                    file's 1.67 white inside hairline and its 15-radius drop
                    shadow, overlapping leftwards, then the file's `+48` at
                    8/10.4. The hairline is what separates one face from the
                    next once they overlap; without it three dark avatars read
                    as one smudge.

                    THE "+N" SUBTRACTS THE FACES ACTUALLY DRAWN from `joined`,
                    never `attendees.length` from anything: the array is capped
                    at three and an anonymous listener resolves to no profile,
                    so its length is a sample and the count is the truth. A
                    room with one attendee shows one face and no +N, which is
                    the honest picture rather than a padded one.
                  */}
                  {room.attendees.length > 0 && (
                    <div className="flex shrink-0 items-center">
                      {room.attendees.slice(0, 3).map((person, index) => (
                        <span
                          key={person.id}
                          className="size-8 shrink-0 overflow-hidden rounded-[10.67px] bg-[#EDEDED] shadow-[0_0_15px_rgba(0,0,0,0.25)] ring-[1.67px] ring-white"
                          style={{ marginLeft: index === 0 ? 0 : -10 }}
                        >
                          <Avatar
                            name={person.displayName || person.username}
                            seed={person.id}
                            src={person.avatarUrl}
                            size={32}
                            sizeClassName="size-full"
                            className="rounded-none border-0"
                          />
                        </span>
                      ))}
                      {typeof room.joined === "number" &&
                        room.joined > Math.min(room.attendees.length, 3) && (
                          <span className="ml-1 text-[8px] font-medium leading-[10.4px] text-white">
                            +{room.joined - Math.min(room.attendees.length, 3)}
                          </span>
                        )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {sharing && (
        <ShareSheet
          open
          onClose={() => setSharing(false)}
          title="Share house"
          payload={{
            text: `${title} on Square`,
            url: `${window.location.origin}${sq(`/houses/${id}`)}`,
          }}
        />
      )}
    </div>
  );
}
