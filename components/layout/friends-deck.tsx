"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconDeckArrow } from "@/components/ui/home-icons";
import { DeckDots } from "@/components/ui/deck-dots";
import { PalCard, DECK_CARD, HOME_DECK_CARD, type PalCardNodeGeometry } from "@/components/layout/pal-card";
import { FriendsFilter } from "@/components/layout/friends-filter";
import { SectionHeading } from "@/components/layout/section-heading";
import { DECK_SORT } from "@/lib/people-filters";
import {
  EMPTY_FRIENDS_FILTER,
  friendsFilterFacets,
  isFriendsFilterActive,
  type FriendsFilter as FriendsFilterState,
} from "@/lib/friends-filter";
import { usePeople } from "@/features/discovery";
import { useMe } from "@/hooks/use-me";
import { useSwipeCard } from "@/hooks/use-swipe-card";
import { SwipeVerdict } from "@/components/layout/swipe-verdict";
import { useFollow, useIsFollowing, usePassProfile } from "@/features/profile";
import { useGate } from "@/hooks/use-gate";
import { cn } from "@/lib/cn";
import { DECK_NODE, HOME_DECK_NODE, PALS_PAGE, deckLayout, type DeckLayout, type DeckNode } from "@/lib/deck-layout";
import type { Profile } from "@/lib/api/schemas";
import { deckCandidates } from "@/lib/deck-candidates";
import { hasWinked } from "@/lib/winks";
import { useSentWinks } from "@/features/profile/lib/wink-store";
import {
  rememberDecision,
  useDeckDecisions,
} from "@/features/profile/lib/deck-decision-store";
import { decidedIds } from "@/lib/deck-decisions";

/**
 * "MAKE SOME FRIENDS" — node 844:18440's deck, on Home and on `/pals`.
 *
 * One person at a time, raised and lifted forward; the two either side of them
 * behind it, tilted and DIMMED to the node's own 0.39 and 0.30 (Home's own deck,
 * 647:16300, dims both to 0.2); the pass X and
 * the wink under the photo; a `<` `>` disc at each edge of the column. It is a
 * DECK rather than a list because a list is a directory you scan and a deck is
 * one person you have to decide about, and deciding is what produces a wink.
 *
 * ─── WHERE THE NUMBERS ARE ──────────────────────────────────────────────────
 * The card is `DECK_CARD` (pal-card.tsx); the fan — offsets, scales,
 * tilts, opacities, the discs' span — is `DECK_NODE` and the one scale factor
 * per width is `deckLayout` (lib/deck-layout.ts, pinned by its test). Both are
 * in the file's units and this component multiplies by `k`, so nothing here is
 * a pixel someone typed.
 *
 * One component for both surfaces, so the wink cooldown, the already-following
 * guard and the swipe cannot be fixed on one and left broken on the other.
 * `/pals` (node 1328:1885, which replaced 844:18511) is this deck given a page
 * of its own: the filter pill above it, the heading BELOW it, and nothing
 * else — `PALS_PAGE` in lib/deck-layout.ts holds that node's offsets.
 *
 * ─── NOTHING IS CUT ─────────────────────────────────────────────────────────
 * `deckLayout` picks the one scale at which the WHOLE fan — both back cards
 * and, from `md`, both discs — fits the column, so no card is ever clipped
 * at its edge. On a phone that means a smaller front card than the column
 * could hold; the owner's rule is that nothing is cut, and it is one rule.
 *
 * ─── SWIPE BROWSES, ICONS ACT ───────────────────────────────────────────────
 * Dragging the front card LEFT goes to the next person and RIGHT to the
 * previous — the same navigation as the two discs, and nothing else: no follow,
 * pass or wink is attached to the gesture. Acting is only ever the front
 * card's own controls — X passes, the face winks, the badge follows — and each
 * steps the deck forward, so the person you just decided about leaves.
 *
 * `useSwipeCard` supplies the drag, the threshold and the fly-out; its two
 * verdicts are mapped to steps, and `canCommit` refuses a step with nowhere to
 * go so the card springs back at either end instead of flying out and sliding
 * back in. At the last loaded person a left swipe asks for the next page
 * rather than pretending the list ended.
 *
 * ─── WHERE THE PEOPLE COME FROM ──────────────────────────────────────────────
 * `GET /profiles?sort=followers` — the real people directory, the same source
 * Explore's People tab reads. There is NO recommendation endpoint, so this is
 * not personalised and does not pretend to be. The viewer is filtered out: you
 * are not somebody you can wink at. PASS is local and honest — there is no
 * "dismiss a person" route, so it moves to the next card and claims no more.
 */
export function FriendsDeck({ heading = "home" }: { heading?: "home" | "pals" }) {
  const me = useMe();
  /*
    THE FILTER IS THE SERVICE'S, and changing it starts a NEW deck: the facets
    are in `usePeople`'s query key, so a new city or gender is a new list from
    page one — and the index goes back to the front of it, because position in
    a list that no longer exists means nothing.
  */
  const [filter, setFilter] = useState<FriendsFilterState>(EMPTY_FRIENDS_FILTER);
  // THE DECK'S OWN ORDERING, named once in lib/people-filters.ts so switching
  // it to the service's ranked `foryou` is one line rather than a hunt.
  const people = usePeople("", DECK_SORT, true, friendsFilterFacets(filter));
  const [index, setIndex] = useState(0);
  const changeFilter = (next: FriendsFilterState) => {
    setFilter(next);
    setIndex(0);
  };

  /*
    HOW WIDE THE COLUMN ACTUALLY IS — measured, not assumed at a breakpoint,
    because it depends on the shell cap, the sidebar's width and the rail.
    A CALLBACK REF fires when the node arrives, which matters because the
    section is absent while the directory loads; an effect keyed on anything
    else runs once against `null` and never again. `wide` is the shell's `md`
    split, read through the same media query the stylesheet uses.
  */
  const [room, setRoom] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const fitRef = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      if (el.clientWidth > 0) setRoom(el.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    observer.current = ro;
  }, []);
  /*
    `/pals` (1328:1885) SPACES ITS PARTS IN THE DECK'S OWN UNITS — the pill
    row, the 45 to the deck, the 177 to the heading — and everything is
    multiplied by the same `k` as the fan, so the page keeps the node's
    proportions at any width (`PALS_PAGE`). Its section is capped at the
    node's 596 from `md`, which is what makes `k` the node's own 0.6248 on a
    desktop column and every number below land on the file's pixel. HOME
    (647:16300) spaces its own parts explicitly — 90 to the deck, 9.38 to the
    pills, 67 to the rule, 60 to the timeline — so its section carries no gap
    of its own, only the 60 under it.
  */
  const sectionClass = cn("flex flex-col", heading === "pals" ? "w-full md:max-w-[596px]" : "mb-10");
  /* HOME DRAWS ITS OWN DECK (647:16300), not `/pals`' at another scale. */
  const node: DeckNode = heading === "home" ? HOME_DECK_NODE : DECK_NODE;
  const card: PalCardNodeGeometry = heading === "home" ? HOME_DECK_CARD : DECK_CARD;
  const layout = deckLayout({ room: room || FALLBACK_ROOM, arrows: true, node });


  /*
    NOBODY THE READER HAS ALREADY ANSWERED FOR.

    The service leaves out people they follow (`excludeFollowing`), which is
    what keeps the CURSOR honest. This is the second half: a page fetched
    before the reader followed somebody still carries them, and after the
    follow that card is a question with an answer on it (ogazboiz, 2026-09-18).
    `isFollowing` is only trusted when the payload carries it — undefined is
    "this payload has no follow edge", never "not followed".
  */
  const winkedHere = useSentWinks(me.data?.id ?? null);
  /*
    EVERY CARD THIS READER HAS ANSWERED, whichever way they answered it.

    The service remembers a follow and a wink; it has no idea about a PASS,
    which is the commonest answer of the three, and its memory of a wink lapses
    with the cooldown — so a face came back a day after being winked at, and a
    face that had been dismissed came back immediately. Both are the same
    complaint: the deck kept re-asking a question the reader had answered.

    This closes the card the instant it is answered and keeps it closed. The
    service's own exclusions still do the real work across devices; a pass is
    asked for and will join them.
  */
  const answered = decidedIds(useDeckDecisions(me.data?.id ?? null));
  /*
    THE CLOCK A LAPSED WINK IS READ AGAINST. Seeded once and nudged on a coarse
    tick: the boundary it decides moves once a DAY, so a minute of staleness
    costs nothing, while `Date.now()` in the render body is both impure and
    something the React Compiler refuses outright.
  */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), WINK_LAPSE_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const items = deckCandidates(people.data?.pages.flatMap((page) => page.items) ?? [], {
    viewerId: me.data?.id ?? null,
    hideFollowed: filter.newOnly,
    // A wink hides the card for as long as the wink itself stands — the same
    // `WINK_COOLDOWN_MS` day the wink CONTROL is disabled for, and the same day
    // the service's own `excludeWinked` leaves them out (ogazboiz, 2026-09-18).
    // Past that the wink has lapsed, and an unanswered question is a question
    // again. `now` is state, not a call to the clock during render.
    winkedHere: (id) => answered.has(id) || hasWinked(winkedHere, id, now),
  });
  const filtering = isFriendsFilterActive(filter);

  const filterPill = (
    <FriendsFilter
      variant={heading === "pals" ? "pals" : "home"}
      className={heading === "home" ? "-mt-[3px]" : undefined}
      value={filter}
      onChange={changeFilter}
      viewerCity={me.data?.city?.trim() || null}
    />
  );
  const header =
    heading === "pals" ? (
      /*
        `/pals`' ROW ABOVE THE DECK is the filter pill and nothing else —
        node 1344:21864 is a 579-wide group starting 26 in (15 past the deck
        group's own 11) with the pill (1344:21865, 86 × 32) flush with its
        right edge, 2 inside the deck's, and 45 above the deck. No back disc,
        no title, no subtitle: 844:18511's title row is gone with that node.
        The insets are the node's in the deck's units, scaled by `k`.
      */
      <div
        className="flex justify-end"
        style={{
          paddingLeft: PALS_PAGE.groupLeft * layout.k,
          paddingRight: PALS_PAGE.groupRight * layout.k,
          marginBottom: PALS_PAGE.pillToDeck * layout.k,
        }}
      >
        {filterPill}
      </div>
    ) : (
      /*
        HOME'S HEADING ROW — node 1305:149175's, which replaced 647:16342's.

        The file sets it in Manrope Bold 24 / 28.61 with "friends" on the
        90deg #C196FD -> #7E3BEB character fill, over a Roboto Bold 10 / 10.16
        sub-line at 40% white. That is the same object the other three sections
        head with, so it is `SectionHeading` rather than a fourth copy of the
        markup — the filter goes in as the live control it is.

        THE PILL SAYS "Filter", NOT the file's "Location" (ogazboiz, 2026-09-12):
        it filters by more than a place now, so the file's older word would be
        the untrue one.

        Only the heading is the new node's. The deck under it, its five pager
        pills and the rule that runs to the window's left edge are 647:16288's
        and stay exactly as they are — the rule in particular was asked for.
      */
      <SectionHeading
        id="make-some-friends"
        lead="Make some"
        accent="friends"
        subtitle="Follow cool people and watch your feed go from boring to elite ✨"
        actionSlot={filterPill}
      />
    );

  /*
    WITH NO FILTER ON, an empty directory means the section has nothing to
    say and is absent. WITH ONE ON, the section must stay — the pill is the
    only way to take the filter off again.
  */
  if (!filtering && (people.isPending || items.length === 0)) return null;
  if (filtering && !people.isPending && items.length === 0) {
    return (
      <section ref={fitRef} aria-label="People to meet" className={sectionClass}>
        {header}
        <div className={cn("flex flex-col items-center gap-3 py-10 text-center", heading === "home" && "mt-6")}>
          <p className="text-[15px] leading-5 text-white/60">Nobody here matches that yet.</p>
          <button
            type="button"
            onClick={() => changeFilter(EMPTY_FRIENDS_FILTER)}
            className="ws-press rounded-full border border-white/20 px-4 py-1.5 text-[13px] font-bold text-white transition-colors hover:bg-white/10"
          >
            Show everyone
          </button>
        </div>
      </section>
    );
  }
  if (people.isPending) {
    return (
      <section ref={fitRef} aria-label="People to meet" className={sectionClass}>
        {header}
        {/* The front card's own footprint, so the column does not jump when it lands. */}
        <div
          className={cn("ws-skeleton mx-auto", heading === "home" && "mt-8 md:mt-22.5")}
          style={{
            width: node.card.width * layout.k,
            height: layout.height,
            borderRadius: card.radius * layout.k,
          }}
        />
      </section>
    );
  }

  const canStep = (delta: number) => {
    const next = index + delta;
    return next >= 0 && next < items.length;
  };
  const step = (delta: number) => {
    if (!canStep(delta)) return;
    const next = index + delta;
    setIndex(next);
    // Keep the deck fed: a reader three cards from the end has already decided
    // to keep going.
    if (next > items.length - 4 && people.hasNextPage && !people.isFetchingNextPage) {
      void people.fetchNextPage();
    }
  };

  // Three at a time: the one being decided about, and its two neighbours
  // behind it. More than that is decoration nobody can read.
  const window = [index - 1, index, index + 1].filter((i) => items[i]);

  /*
    WHICH SLOT EACH CARD TAKES. The file's LEFT card sits behind the front
    card's left edge and its RIGHT card behind the right. With only TWO people
    left — the end of the list — the spare one takes the right slot rather
    than the left, so there is always visibly somebody after this one; which of
    the two is "previous" is not something the reader reads off the geometry.
  */
  const slotOf = (position: number) => {
    const slot = position - index;
    const spareOnLeftOnly =
      window.length === 2 && window.includes(index - 1) && !window.includes(index + 1);
    return spareOnLeftOnly && slot === -1 ? 1 : slot;
  };

  const arrowSize = node.arrow.size * layout.k;

  return (
    <section ref={fitRef} aria-label="People to meet" className={sectionClass}>
      {header}

      {/*
        THE DECK BOX is the column's width and the front card's height, the
        cards absolutely placed in it in file units and scaled about their
        centres by `k` — a `k` chosen so the WHOLE fan fits and nothing is
        cut. `overflow-x-clip` only catches a card mid-swipe flying out.

        `isolate` IS LOAD BEARING. The fan's layers — the front card over its
        neighbours (z-20 over z-10) and the two discs over both (z-30) — are
        this box's internal business, but the box is `relative` at `z-index:
        auto`, which is NOT a stacking context: without `isolate` those three
        numbers are hoisted into the PAGE's root stacking context and compete
        with everything else drawn on Home. The filter menu that hangs off
        "Make some friends" is the column's own popover at the house's `z-20`,
        and it is written EARLIER in the document than this box, so the tie at
        20 was broken by document order in the deck's favour and the menu was
        painted under the front card — unusable, on both widths. Isolating the
        box makes it one atomic unit painted at the `z-index: auto` level, and
        a positive `z-index` always paints above that level whatever the
        document order, so the popover clears the whole fan by the spec rather
        than by a bigger number. It also puts the menu's click-catcher over
        the deck, which is what makes a click on a card close the menu instead
        of deciding about a person.
      */}
      <div
        className={cn("relative isolate w-full overflow-x-clip", heading === "home" && "mt-8 md:mt-22.5")}
        style={{ height: layout.height }}
      >
        {window.map((position) => (
          <DeckCard
            key={items[position]!.id}
            profile={items[position]!}
            slot={slotOf(position)}
            layout={layout}
            node={node}
            card={card}
            /*
              BOTH DECKS DECIDE. Home's card is the same question `/pals` asks
              — wink or pass — so it carries the file's own verdict stamps,
              the green flag and the red one, as the gesture crosses
              (ogazboiz, 2026-09-18: "you know that red flag and green flag
              please show it in that wink card in home"). Browsing is still
              the `<` `>` discs, which move without deciding anything.
            */
            decide
            canStep={canStep}
            onStep={step}
            onNeedMore={() => {
              if (people.hasNextPage && !people.isFetchingNextPage) void people.fetchNextPage();
            }}
          />
        ))}

        {/*
          The `<` `>` discs, 844:22642 and 844:22639: 64 glass discs, their
          centres 29 below the front card's at -444.55 and +408.45 — the left
          one on the column's edge, the right one INSIDE the fan over the
          right card. They are NOT a mirrored pair: the left is black at 20%
          with a `#979797` chevron, the right white at 16% with a white
          chevron — read node by node. Figma's GLASS effect is a backdrop blur
          with a lit rim; the rim is an inset highlight here. Their 32px inner
          ring has a zero-weight stroke and is not drawn. An inert disc keeps
          its strength — the file draws both at full — and is a real
          `disabled`.

          ON EVERY SIZE, not desktop only. They were `wide`-gated on the
          reasoning that "on a phone the fan is browsed by hand" — true while
          the gesture was navigation, and wrong the moment `/pals` made it a
          DECISION: a swipe there follows or skips and only goes forward, so
          without these a mis-swipe on a phone could not be taken back at all.
          They are also the cheapest thing on the deck to show, which is what
          settles it: `deckExtent` grows from 943 file units to 954 when the
          discs are counted, because the fan is already wider than the right
          disc. A 1.2% smaller card buys the only way back.
        */}
        <DeckArrow
          direction="prev"
          disabled={!canStep(-1)}
          onClick={() => step(-1)}
          size={arrowSize}
          lens={node.arrow.lens}
          left={layout.frontX + (node.arrow.leftDx - node.arrow.size / 2) * layout.k}
          top={layout.frontY + (node.arrow.dy - node.arrow.size / 2) * layout.k}
        />
        {/* No right disc where the node hides the next person (Home, 2026-09-12):
            going on is the pass, or a swipe left. */}
        {!node.hideNext && (
          <DeckArrow
            direction="next"
            disabled={!canStep(1)}
            onClick={() => step(1)}
            size={arrowSize}
            lens={node.arrow.lens}
            left={layout.frontX + (node.arrow.rightDx - node.arrow.size / 2) * layout.k}
            top={layout.frontY + (node.arrow.dy - node.arrow.size / 2) * layout.k}
          />
        )}
      </div>

      {/*
        THE PAGE PILLS — node 289:5455, three of them under the deck.

        They say "there is more after this one", which is the one thing a fan
        cannot: the two cards behind the front are the same two whether the
        roster holds four people or four hundred. Dropped in the rewrite and
        back on EVERY size, phones included — a phone is where the fan is
        smallest and the reassurance matters most.

        THREE PILLS CANNOT COUNT AN UNBOUNDED ROSTER, so they do not try: the
        reader's position is mapped across the three, which is all a row of
        four-pixel pills can honestly say. With one person there is nothing to
        page through and the row is absent rather than showing a lit pill and
        two dead ones.
      */}
      {heading === "home" ? (
        items.length > 1 && (
          /* 647:16296 — FIVE pills, 9.38 under the deck, centred 5.61 right of
             the front card's centre, as the file draws them. */
          <div
            className="mt-[9.38px]"
            style={{ paddingLeft: Math.max(0, layout.frontX + HOME_DOTS.dx * layout.k - HOME_DOTS.width / 2) }}
          >
            <DeckDots variant="home" count={5} active={Math.round((index / (items.length - 1)) * 4)} className="justify-start" />
          </div>
        )
      ) : (
        /*
          `/pals`' pills sit INSIDE the node's 177 between the deck and the
          heading (1328:1885 draws no pills; the three are the reader's, kept
          on every size — see the note above), 24 under the deck. The block is
          the node's own height so the heading lands where the file puts it
          whether or not the row is drawn.
        */
        <div className="flex flex-col items-center pt-6" style={{ height: PALS_PAGE.deckToHeading * layout.k }}>
          {items.length > 1 && <DeckDots count={3} active={Math.round((index / (items.length - 1)) * 2)} />}
        </div>
      )}

      {/*
        `/pals`' HEADING IS UNDER THE DECK — node 1344:21868, "Make some
        friends" at y=1016, 26 in (15 past the deck group's 11): Manrope Bold
        24 / 28.61, "friends" on the 90deg #C196FD -> #7E3BEB character fill
        (`styleOverrideTable[2]`), no subtitle. It is the same object Home
        heads its sections with, so it is `SectionHeading`.
      */}
      {heading === "pals" && (
        <div style={{ paddingLeft: PALS_PAGE.groupLeft * layout.k }}>
          <SectionHeading id="make-some-friends" lead="Make some" accent="friends" />
        </div>
      )}

      {/* No rule under the section any more: 647:17210 drew one, but the
          2026-09-12 column (1305:149185) runs straight on to the next section
          on its 64 of gap, with nothing between (ogazboiz, 2026-09-12). */}
    </section>
  );
}

/** Before the first measurement: Home's desktop column. Replaced before paint by the callback ref. */
const FALLBACK_ROOM = 552;

/** How often the deck re-reads the clock, to notice a wink that has lapsed in a tab left open. */
const WINK_LAPSE_TICK_MS = 5 * 60 * 1000;

/** Home's pill row, 647:16296: its centre 5.61 right of the front card's, and its drawn width (one 36.29 pill, four 13.79, four 3.63 gaps). */
const HOME_DOTS = { dx: 5.61, width: 36.29 + 4 * 13.79 + 4 * 3.63 };

function DeckArrow({
  direction,
  disabled,
  onClick,
  size,
  lens,
  left,
  top,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
  size: number;
  /**
   * How the GLASS is drawn. `sampled` is 1328:1885's render, measured (see
   * `ws-deck-lens-left` / `-right` in globals.css): a lit rim on two opposite
   * diagonals and no ring, the left disc the right's reflection. Absent, the
   * sheen Home's deck has always had.
   */
  lens?: "sampled";
  left: number;
  top: number;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={direction === "prev" ? "Previous person" : "Next person"}
      className={cn(
        "ws-press absolute z-30 flex items-center justify-center rounded-full backdrop-blur-md transition-opacity disabled:cursor-default disabled:opacity-70",
        lens === "sampled"
          ? direction === "prev"
            ? "ws-deck-lens-left"
            : "ws-deck-lens-right"
          : "shadow-[inset_0_1px_0_rgba(255,255,255,0.22),inset_0_0_0_1px_rgba(255,255,255,0.08)]",
        direction === "prev" ? "bg-black/20 text-[#979797]" : "bg-white/16 text-white"
      )}
      style={{ width: size, height: size, left, top }}
    >
      {/* One glyph, mirrored for `next` — 844:22641 is 844:22644 flipped. Its 24 box is 3/8 of the disc. */}
      <IconDeckArrow
        className={cn("shrink-0", direction === "next" && "-scale-x-100")}
        style={{ width: size * 0.375, height: size * 0.375 }}
      />
    </button>
  );
}

/**
 * One card in the fan.
 *
 * The neighbours are SMALLER, TILTED, BEHIND and DIMMED — the node's own
 * opacity on each. Their controls are inert and they are `aria-hidden`: only
 * the front card is the thing being decided about, and a screen reader offered
 * three winks would be offered two that do nothing.
 */
function DeckCard({
  profile,
  slot,
  layout,
  node,
  card,
  decide,
  canStep,
  onStep,
  onNeedMore,
}: {
  profile: Profile;
  slot: number;
  layout: DeckLayout;
  /** Whose deck: Home's 647:16300 or `/pals`' 844:18440. */
  node: DeckNode;
  card: PalCardNodeGeometry;
  /**
   * True on `/pals`: the gesture is a DECISION and carries the file's verdict
   * stamps. False on Home, where it stays navigation. See the note below.
   */
  decide: boolean;
  canStep: (delta: number) => boolean;
  onStep: (delta: number) => void;
  /** A left swipe on the last loaded person: ask for more rather than refuse. */
  onNeedMore: () => void;
}) {
  const front = slot === 0;
  const place = node.places[slot] ?? node.places[0]!;
  const { k } = layout;

  /*
    THE GESTURE MEANS TWO DIFFERENT THINGS, AND THE PAGE DECIDES WHICH.

    ON HOME IT IS NAVIGATION. The hook's "follow" is a rightward drag and its
    "pass" a leftward one; there right means BACK and left means NEXT, and
    neither touches the service. `canCommit` is what makes the ends of the list
    spring back rather than fly. The deck is one block in a timeline there, and
    a gesture that silently followed somebody while they scrolled past would be
    an action nobody asked for.

    ON `/pals` IT IS A DECISION, which is what the deck is for on a page of its
    own: RIGHT FOLLOWS, LEFT SKIPS, and the file's verdict stamps announce
    which before the finger lifts (856:23668 and 856:23693).

    A FOLLOW IS A REAL ACT AND A SKIP IS NOT. Right sends `useFollow` behind
    the sign-in gate, guarded by `isFollowing` so swiping right on somebody you
    already follow cannot toggle them OFF — which a bare `mutate(!isFollowing)`
    would. Left tells the service nothing: there is no "dismiss a person"
    route, and a preference kept in this tab alone is one that lies the moment
    you open another. Both then step forward, because either way this card has
    been dealt with.

    DECIDING ONLY GOES FORWARD, so `canCommit` asks for the next page at the
    end rather than refusing. The `<` `>` discs are still how you go back.
  */
  const follow = useFollow(profile);
  const isFollowing = useIsFollowing(profile);
  const gate = useGate();
  /*
    THE ANSWER IS RECORDED WHERE IT IS GIVEN, on the tap rather than on the
    response. A pass has no response to wait for at all, and a follow that only
    closed the card once the service replied would leave it under the reader's
    thumb through the whole round trip — which is precisely when the next swipe
    lands on it.
  */
  const viewer = useMe();
  const pass = usePassProfile();
  const remember = (decision: "passed" | "winked" | "followed") => {
    rememberDecision(viewer.data?.id ?? null, profile.id, decision);
    // The local record closes the card; this is what makes it stay closed on
    // the reader's other devices. A follow and a wink already tell the service
    // themselves — a pass had nothing to tell until now.
    if (decision === "passed") pass.mutate({ profileId: profile.id, passed: true });
  };

  const swipe = useSwipeCard({
    width: node.card.width * k,
    disabled: !front,
    canCommit: (decision) => {
      if (decide) {
        if (canStep(1)) return true;
        onNeedMore();
        return false;
      }
      const delta = decision === "follow" ? -1 : 1;
      if (canStep(delta)) return true;
      if (delta === 1) onNeedMore();
      return false;
    },
    onDecide: (decision) => {
      if (!decide) {
        onStep(decision === "follow" ? -1 : 1);
        return;
      }
      if (decision === "follow" && !isFollowing) gate(() => follow.mutate(true));
      // A left swipe is a real answer even though it sends nothing.
      remember(decision === "follow" ? "followed" : "passed");
      onStep(1);
    },
  });

  return (
    <div
      aria-hidden={!front}
      {...(front ? swipe.handlers : {})}
      className={cn(
        "absolute origin-center",
        // `pan-y` hands vertical scrolling back to the browser, so the deck can
        // never trap the timeline it sits inside.
        front && "touch-pan-y select-none",
        /*
          A CARD THAT IS NOT THE FRONT ONE TAKES NO POINTERS AT ALL.

          `aria-hidden` above says it is not content; this says it is not a
          target. They have to agree, and they did not: a back card was hidden
          from a screen reader and still fully tappable, which is the worst of
          both — invisible to the people who navigate by structure, live to
          everybody who navigates by touch.

          Belt to pal-card's braces. That guards the card FACE for any caller;
          this guarantees the deck's own invariant no matter what is added to
          a card later. Paging stays with the arrows, the dots and the swipe,
          which are the affordances the file draws.
        */
        !front && "pointer-events-none",
        // No transition WHILE a finger is down, or the card lags the hand.
        swipe.dragging
          ? "transition-none"
          : "transition-[transform,opacity] duration-300 motion-reduce:transition-none",
        front ? "z-20" : "z-10",
        /*
          BOTH SIDES BLUR, which is NOT what the file draws.

          The design blurs only the NEXT card — "who is next stays a surprise"
          — and leaves the previous one dim but readable. ogazboiz looked at it
          running and asked for the left to match the right, and it is his
          call: the asymmetry reads as a rendering fault rather than as intent,
          and the card behind you is somebody you have already been shown, so
          softening it gives nothing away that was not already given.

          Still gated on `hideNext`, so a deck configured to show its next card
          plainly keeps both sides sharp rather than gaining a blur the layout
          never asked for.
        */
        node.hideNext && Math.abs(slot) === 1 && "blur-[7px]"
      )}
      style={{
        // The card's box is the file's 543.42 × 718; it is centred on the front
        // card's spot and everything else is a transform about that centre.
        left: layout.frontX - node.card.width / 2,
        top: layout.frontY - node.card.height / 2,
        // The drag is prepended so it moves in SCREEN space, on top of the
        // fan's own placement rather than inside it.
        transform: `${front ? swipe.transform : ""} translate(${place.dx * k}px, ${place.dy * k}px) rotate(${place.rot}deg) scale(${place.scale * k})`,
        opacity: swipe.committing ? 0 : place.opacity,
      }}
    >
      <PalCard
        profile={profile}
        geometry={card}
        interactive={front}
        onPass={() => {
          remember("passed");
          onStep(1);
        }}
        onWinked={() => {
          remember("winked");
          onStep(1);
        }}
        onFollowed={() => {
          remember("followed");
          onStep(1);
        }}
      />
      {/* Only the front card, and only where the gesture decides — a stamp on
          a card you are merely paging past would promise an act that is not
          happening. `k` is 1 here because the card's own box is already scaled
          by the transform above; the stamp rides inside it. */}
      {decide && front && (
        <SwipeVerdict progress={swipe.progress} verdict={swipe.verdict} k={1} />
      )}
    </div>
  );
}
