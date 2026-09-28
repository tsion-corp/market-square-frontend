"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { Spinner } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryParam } from "@/hooks/use-query-param";
import { useComposePrefill } from "@/hooks/use-compose-prefill";
import { useFeed, useFeedHead, usePost } from "@/features/feed/hooks/use-feed";
import { useLaneSignal } from "@/features/feed/hooks/use-lane-signal";
import { Composer } from "@/features/feed/components/composer";
import { VideoViewer } from "@/features/feed/components/video-viewer";
import type { VideoItem } from "@/lib/video-context";
import { FeedItemCard } from "@/features/feed/components/feed-cards";
import type { FeedItem, Lane, Post } from "@/features/feed/lib/types";
import type { Profile } from "@/lib/api/schemas";
import { MARKET_FLAGS } from "@/lib/market-config";
import { useMarketView } from "@/lib/analytics";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useMe } from "@/hooks/use-me";
import { useNewPosts } from "@/features/feed/hooks/use-new-posts";
import { NewPostsPill } from "@/features/feed/components/new-posts-pill";
import { sq } from "@/lib/square-path";

/** How many posts stand between the top of the feed and "Join a community". */
const BEFORE_COMMUNITY = 2;
/**
 * ...and how many before "Suggested Pals" (540:19351).
 *
 * Far enough in that the reader has seen what the square sounds like before
 * being asked to meet anybody, and not so far that it only exists for people
 * who scroll. The file cannot settle it — it draws the rail on its own — so
 * four is a judgement call, changed by this line alone.
 *
 * A CEILING, NOT A THRESHOLD. Both this and BEFORE_COMMUNITY fall back to the
 * last post when the feed is shorter, so neither section disappears on a young
 * square. On a one-post feed that stacks the community grid and the pals rail
 * after the same post, in that order; both are invitations to go somewhere
 * else, and showing them is better than showing neither.
 */
const BEFORE_PALS = 4;

/*
  Lanes filter the timeline, in the design's order.

  REELS IS GONE, by product decision and not by accident. The endless vertical
  scroll is the shape of a video product, and Market Square is not one — it is
  a place to talk in a room and meet the people in it. A lane that swallows a
  reader for twenty minutes is in direct competition with that, and while it
  existed Home had two centres.

  What did NOT go with it: video in a post, the upload that makes one, and the
  story viewer. Media still belongs in the feed. What it no longer does is
  become a river you fall into — to see what somebody has posted you go to
  their profile, which is where their media lives.
*/
/**
 * Empty copy per lane.
 *
 * An empty lane is the normal state of a young square, so each one says WHY it
 * is empty and offers the action that fills it. A bare "no data" panel reads
 * as a broken app; a reason plus a next step reads as an early one.
 *
 * `cta` is resolved against the viewer: `authed` gates actions that need a
 * session, so a signed-out reader is never sent at a wall.
 */
interface LaneEmpty {
  title: string;
  body: string;
  cta?: { label: string; href: string; authed?: boolean };
}

const EMPTY_COPY: Record<Lane, LaneEmpty> = {
  "for-you": {
    title: "The square is quiet",
    body: "Nothing has been posted yet. Be the first, or go and find people worth following.",
    cta: { label: "Find creators", href: sq("/spotlight") },
  },
  following: {
    title: "You're not following anyone yet",
    body: "This lane shows posts from people you follow. Follow a few and it fills up.",
    cta: { label: "Find people to follow", href: sq("/spotlight") },
  },
  /*
    A PAL IS A MUTUAL FOLLOW, so this lane is empty until somebody follows
    back — which on a young graph is most people, most of the time. The copy
    therefore has to explain the RULE rather than blame the reader: "nobody
    here yet" reads as a dead product, while naming the condition tells them
    exactly what would change it.

    It sends them to the deck rather than to a directory. Following someone is
    only half a pal; the deck is where the other half gets asked for.
  */
  pals: {
    title: "No pals yet",
    body: "A pal is someone you follow who follows you back. Their posts land here once they do.",
    cta: { label: "Meet people", href: sq("/") },
  },
  live: {
    title: "Nobody's live right now",
    body: "Live streams and scheduled sessions appear here the moment they start.",
    cta: { label: "Go live", href: sq("/studio"), authed: true },
  },
  reels: {
    title: "No clips yet",
    body: "Reels are posts with video. Publish one and it lands here.",
    cta: { label: "Create a post", href: sq("/?compose=1"), authed: true },
  },
  trending: {
    title: "Nothing trending yet",
    body: "Once posts start collecting likes and replies, the busiest land here.",
    cta: { label: "Browse the feed", href: sq("/") },
  },
  platform: {
    title: "No platform news",
    body: "Official WorldStreet announcements appear here.",
    // Sending readers to the Store from a news lane was always a non-sequitur;
    // with `storeNav` off it would also be the one place still promoting it.
    ...(MARKET_FLAGS.storeNav
      ? { cta: { label: "Browse the ARK Store", href: sq("/store") } }
      : {}),
  },
};

/** The action under an empty lane, or nothing when it needs a session. */
function LaneCta({ empty, authenticated }: { empty: LaneEmpty; authenticated: boolean }) {
  const cta = empty.cta;
  if (!cta || (cta.authed && !authenticated)) return null;
  return (
    <Link
      href={cta.href}
      className="ws-press inline-flex rounded-full border border-white/20 px-4 py-1.5 text-[13px] font-bold text-body transition-colors hover:bg-white/10"
    >
      {cta.label}
    </Link>
  );
}

function PostSkeleton() {
  return (
    <div className="ws-post space-y-3 p-3">
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-9 w-9 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-2.5 w-20" />
        </div>
      </div>
      <Skeleton className="h-44 w-full rounded-2xl" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  );
}

// Mobile Home stays the vertical snap feed; desktop is the card timeline.
const NO_TOPICS: string[] = [];

export function FeedPage({
  mode = "feed",
  topics = NO_TOPICS,
  postsSlot,
  followSlot,
  winkSlot,
  tipSlot,
  headSlot,
  searchSlot,
  roomsSlot,
  friendsSlot,
  comingSoonSlot,
  partnersSlot,
  housesSlot,
  communitySlot,
  palsSlot,
}: {
  /**
   * WHICH HALF OF THIS PAGE TO DRAW.
   *
   * `home` — the sections, closing with the "Post For You" rail, and NO
   *   timeline. The 2026-09-12 design draws six sections and no feed, and
   *   ogazboiz confirmed it: a rail showing the same lane a list underneath was
   *   already showing put the same post on screen twice.
   * `feed` — the timeline itself, which is what "View more" opens at `/feed`:
   *   the endless list, the composer, the new-posts pill and the full-screen
   *   video viewer, all unchanged.
   *
   * `pals` — node 1328:1885's column: the head (the search row and the
   *   stories, composed in `pals-screen`), the friends deck, then the
   *   FOLLOWING lane as the list (1344:21876 — every card on it carries a
   *   "Following" author state). Nothing else: no banner, rooms, coming-soon,
   *   houses or suggested pals; the page draws none. The same list, composer,
   *   new-posts pill and viewer as `feed`, at the node's own width and gap.
   *
   * One component rather than two, because everything except the list is
   * shared, and a second copy is how the composer or the viewer ends up fixed
   * on one surface and broken on the other.
   */
  mode?: "home" | "feed" | "pals";
  /**
   * Topic keys narrowing the lane — `GET /feed?topics=`. `/pals` heads its
   * list with the topic row (647:16266), whose selection is owned by the
   * layout: `GET /topics` is the discovery slice's and this one may not
   * import it. Empty is "no filter". Pass a stable reference.
   */
  topics?: readonly string[];
  /** The rail Home shows instead of a timeline (1314:153017). */
  postsSlot?: React.ReactNode;
  followSlot?: (author: Profile) => React.ReactNode;
  winkSlot?: (author: Profile) => React.ReactNode;
  /** Composed from outside the slice — the tip control lives in the tips
   *  slice and takes the POST, since a tip goes to `/posts/:id/tips`. */
  tipSlot?: (post: Post) => React.ReactNode;
  /**
   * The three sections the file puts around the timeline, each composed in
   * `components/layout` because each reads a slice this one may not import:
   * the open gist rooms (225:3822), the people deck (225:3374) and the
   * community grid (258:5545).
   */
  roomsSlot?: React.ReactNode;
  /**
   * What opens the column — the search row and the banner (1295:142736 and
   * 1305:149178), composed in `home-screen` and drawn ABOVE everything else.
   */
  headSlot?: React.ReactNode;
  /**
   * What Home shows INSTEAD of its sections while the reader is searching.
   *
   * The sections are the resting state of the page, not the page itself, so a
   * query replaces them rather than being appended under them — results under
   * four shelves of unrelated content is a page that did not answer.
   */
  searchSlot?: React.ReactNode;
  friendsSlot?: React.ReactNode;
  /**
   * Gist rooms with a time on them, under the people deck. Renders nothing
   * while nothing is scheduled, so it costs no space on a quiet square.
   */
  comingSoonSlot?: React.ReactNode;
  /**
   * The partners card, on a PHONE only.
   *
   * It already sits in the right rail, which is hidden below lg — so without
   * this it is a desktop-only object, and the design puts it on the phone
   * directly under Coming Soon. Mounted here rather than in the rail's own
   * list so it cannot render twice on one screen.
   */
  partnersSlot?: React.ReactNode;
  /**
   * "Popular Houses" (1305:149179), the last section of the new Home. Renders
   * nothing when no public house exists.
   */
  housesSlot?: React.ReactNode;
  communitySlot?: React.ReactNode;
  /** The pals rail (540:19351), dropped a few posts into the timeline. */
  palsSlot?: React.ReactNode;
}) {
  const compose = useQueryParam("compose");
  const prefill = useComposePrefill();
  /*
    THE TIMELINE RUNS ON, AND "JOIN A COMMUNITY" SITS INSIDE IT.

    It used to show three posts and stop at a "Load more" row (242:4890), for
    one reason: the community grid came after the feed, and a grid placed under
    a list that never ends can never be reached. Interleaving the grid instead
    removes that constraint — it now sits after the first post, where it is on
    the first screen whatever the feed does — so the floor under the feed came
    out with it and the timeline pages itself as the reader scrolls.

    Nothing is held back any more: every post that has been fetched is on the
    page, and reaching the end asks for the next page rather than waiting to be
    asked.
  */
  // `/pals` reads the FOLLOWING lane — the people the reader decided about in
  // the deck above it are who the list is for. Home and /feed stay on
  // for-you.
  /*
    /pals READS THE PALS LANE NOW, NOT THE FOLLOWING ONE.

    A follow is one-directional, so following a single loud stranger put them
    all over the surface that is meant to be your people — which is why /pals
    read as Home with different SQL. The pals lane is the MUTUAL follows:
    somebody had to choose you back.

    Empty is a legitimate answer and is deliberately NOT widened back to the
    following lane here, for the same reason the service refuses to widen it:
    a surface that quietly returns something other than what its name says is
    worse than one that returns nothing. The people sections above it — who is
    in a room, and your pals — carry the page while the graph is thin.
  */
  const lane: Lane = mode === "pals" ? "pals" : "for-you";
  // Home has no topic row any more (ogazboiz, 2026-09-12), so its lane is
  // never narrowed and `topics` stays the module-level empty list; `/pals`'
  // row narrows the following lane through the prop. A topic narrows what is
  // in the lane, it does not change how the lane is ranked.
  const narrowed = topics.length > 0;
  const [composerOpen, setComposerOpen] = useState(false);
  // The post being quoted, if the composer was opened from a repost menu.
  const [quoting, setQuoting] = useState<Post | null>(null);
  const { ready, authenticated, login } = useAuth();
  // The following lane is the reader's own edge: signed out there is nobody
  // it could be for, so it is not asked for and the sign-in copy stands in.
  const gated = mode === "pals" && !authenticated;
  const feed = useFeed(lane, topics, !gated);

  /*
    THE HEAD CHECK (`useFeedHead`) runs every 30 seconds while the tab is
    visible and the timeline has loaded. Anything it returns that the
    timeline does not already have is put IN FRONT of the loaded list, by
    id — the timeline's own order for what it has, the head's for what is
    new. From there `useNewPosts` holds the new items behind the pill while
    the reader is scrolled, and merges them at the top. Nothing here decides
    what is "new"; that is the hold's job, against what the reader has seen.
  */
  const head = useFeedHead(lane, topics, feed.isSuccess);
  // The ws-gateway's "head changed" frame re-asks that same head at once —
  // when a gateway is configured; otherwise the tick above is the whole story.
  useLaneSignal(lane, topics, feed.isSuccess);
  const loaded = useMemo(() => {
    const paged = feed.data?.pages.flatMap((page) => page.items) ?? [];
    const have = new Set(paged.map((item) => item.id));
    const fresh = (head.data?.items ?? []).filter((item) => !have.has(item.id));
    return fresh.length > 0 ? [...fresh, ...paged] : paged;
  }, [feed.data?.pages, head.data?.items]);
  /*
    Everything that has been fetched — except what arrived ABOVE the reader
    while they were scrolled, which waits behind the "N new posts" pill until
    they tap it (see `useNewPosts`). At the top it merges in place; the
    reader's own posts always show at once.
  */
  const me = useMe();
  const fresh = useNewPosts({
    items: loaded,
    laneKey: `${lane}:${topics.join(",")}`,
    meId: me.data?.id ?? null,
  });
  const laneItems = fresh.shown;
  /*
    "SEE MORE, STARTING FROM THIS ONE." Tapping a post on Home opens /feed with
    `?post=<id>`, and that post is pinned to the TOP of the timeline: if the lane
    already carries it, it is lifted to the front; if it has not paged in yet, it
    is fetched and prepended. The rest of the lane continues underneath, so the
    reader lands on the post they chose and can keep scrolling the feed.
  */
  const leadId = useQueryParam("post");
  const leadPost = usePost(leadId ?? "");
  const items = useMemo(() => {
    if (!leadId) return laneItems;
    const rest = laneItems.filter((item) => (item.post?.id ?? item.id) !== leadId);
    const already = laneItems.find((item) => (item.post?.id ?? item.id) === leadId);
    const lead: FeedItem | null =
      already ??
      (leadPost.data
        ? {
            id: leadPost.data.id,
            type: "post",
            occurredAt: leadPost.data.createdAt,
            repostedBy: null,
            deepLink: leadPost.data.deepLink ?? null,
            post: leadPost.data,
            stream: null,
            activity: null,
            platformEvent: null,
          }
        : null);
    return lead ? [lead, ...rest] : laneItems;
  }, [laneItems, leadId, leadPost.data]);
  const listRef = useRef<HTMLDivElement>(null);
  const canLoadMore = Boolean(feed.hasNextPage);
  /* The shared sentinel every other paged list in the app uses — 600px of
     rootMargin, so the next page is asked for before the reader arrives. */
  const sentinelRef = useInfiniteScroll(() => {
    if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
  }, canLoadMore);

  /**
   * What the full-screen viewer scrolls: every MEDIA post of the lane, photos
   * included, in lane order.
   *
   * Clips only would strand a reader who expanded a photo on a single slide
   * with nothing above or below it, and would skip past the photos of the lane
   * they were reading.
   */
  const mediaItems = useMemo(
    () =>
      items.flatMap((item) =>
        item.type === "post" && item.post?.mediaUrl ? [item.post as VideoItem] : []
      ),
    [items]
  );
  const [openVideoId, setOpenVideoId] = useState<string | null>(null);

  // The card morphs into the player. Feature-detected, and skipped under
  // reduced motion, the same rule Explore's grid uses.
  const openMedia = (post: Post) => {
    const apply = () => setOpenVideoId(post.id);
    if (
      !document.startViewTransition ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      apply();
      return;
    }
    document.startViewTransition(apply);
  };
  const showComposer = composerOpen || compose === "1" || compose === "story";
  useMarketView("feed_viewed", {
    surface: mode === "pals" ? "market_square_pals" : "market_square_home",
    source: narrowed ? topics.join(",") : lane,
  });

  /*
    THE LIST'S BODY, written once. `/pals` draws it inside the node's own
    wrapper (573.14 wide on a 47.89 gap, 1344:21877) and Home's timeline
    inside its 63.42 rhythm, so the wrapper is per surface and the states and
    cards inside it are not — a second copy is how the empty copy or the
    quote handler ends up fixed on one page and broken on the other.
  */
  const listBody = (
    <>
      {feed.isPending && [0, 1, 2].map((i) => <PostSkeleton key={i} />)}
      {feed.isError && (
        <ErrorState error={feed.error} fallback="Couldn't load the feed." onRetry={() => feed.refetch()} />
      )}
      {/* A narrowed lane that is empty is empty BECAUSE of the topic, so the
          copy says so and offers another pill rather than the lane's own
          "follow somebody" answer, which would be the wrong diagnosis. */}
      {feed.isSuccess && items.length === 0 && (
        <EmptyState
          glyph="◇"
          title={narrowed ? "Nothing here yet" : EMPTY_COPY[lane].title}
          body={
            narrowed
              ? "Nobody has posted under this topic yet. Try another, or start the conversation."
              : EMPTY_COPY[lane].body
          }
          action={narrowed ? null : <LaneCta empty={EMPTY_COPY[lane]} authenticated={authenticated} />}
        />
      )}
      {items.map((item, index) => (
        <Fragment key={item.id}>
          <div className="ws-enter">
            <FeedItemCard
              item={item}
              followSlot={followSlot}
              winkSlot={winkSlot}
              onOpenMedia={openMedia}
              tipSlot={tipSlot}
              onQuote={(post) => {
                setQuoting(post);
                setComposerOpen(true);
              }}
            />
          </div>
          {/*
            NODE 647:16515 — "Join a community", INSIDE the timeline rather
            than under it, after the SECOND post as the live file places it.

            It used to close the page, which only worked while the feed had
            a floor: a grid below a list that pages forever is a grid nobody
            reaches. Two posts above it keep it near the top, where
            somebody who has just seen what the square sounds like is being
            offered a room to say it in.

            Rendered against the LAST post when the feed is shorter than the
            cut, so a one-post lane still shows it rather than dropping it.
            It sits in the list's own 63.42 rhythm and carries no padding of
            its own.
          */}
          {communitySlot &&
            index === Math.min(BEFORE_COMMUNITY - 1, items.length - 1) && (
              <div>{communitySlot}</div>
            )}
          {/* NODE 540:19351 — the pals rail, deeper into the timeline than
              the community grid, and pinned to the LAST post when the feed
              is shorter than the cut. A young square has three posts in it,
              and a section that only exists once there are four would be
              missing exactly when meeting people matters most. */}
          {palsSlot && index === Math.min(BEFORE_PALS - 1, items.length - 1) && (
            <div>{palsSlot}</div>
          )}
        </Fragment>
      ))}
    </>
  );

  /*
    The end of the list asks for the next page itself — node 242:4890's
    "Load more" row is gone. The sentinel sits 600px ahead of the reader
    (`useInfiniteScroll`), so the next posts are usually already there by
    the time they arrive; the spinner is what shows when they are not.
  */
  const listTail = (
    <>
      {canLoadMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
      {feed.isFetchingNextPage && (
        <div className="flex justify-center py-6">
          <Spinner className="h-4 w-4" />
        </div>
      )}
      {feed.isSuccess && !canLoadMore && items.length > 0 && (
        <p className="py-8 text-center text-sm text-meta">You&apos;re all caught up.</p>
      )}
    </>
  );

  const composer = authenticated && showComposer && (
    <div className="ws-post mb-4">
      <Composer
        autoFocus
        asStory={compose === "story"}
        prefill={prefill}
        quoted={quoting}
        onDone={() => {
          setQuoting(null);
          setComposerOpen(false);
          // Drop the share parameters too, or reopening the composer
          // re-seeds the draft that was just published.
          if (compose !== null) {
            window.history.replaceState(null, "", window.location.pathname);
          }
        }}
      />
    </div>
  );

  /* Full screen, swipeable, paging the same lane. This is the promotion a
     tap on a video card performs. */
  const viewer = openVideoId && (
    <VideoViewer
      items={mediaItems}
      activeId={openVideoId}
      onActiveChange={setOpenVideoId}
      onClose={() => setOpenVideoId(null)}
      hasNextPage={Boolean(feed.hasNextPage)}
      isFetchingNextPage={feed.isFetchingNextPage}
      fetchNextPage={() => void feed.fetchNextPage()}
      morphNameFor={(mediaId) => `media-${mediaId}`}
    />
  );

  if (mode === "pals") {
    return (
      <>
        {/*
          `/pals` — node 1328:1885 in its page 1328:1882, which draws the
          column's content in the left 618 (1331:21792) and the RAIL beside it
          at x=618: so it is the shell's 600 column with `RightRail`, not a
          FULL route. Column-relative: the search row at (13, 12), the
          stories at (13, 111), and the list at (25, y) — 573.14 wide on a
          47.89 gap, its edge on 598.14. From md the wrapper carries no
          gutter and every child sits at the node's own x, so those numbers
          land on a 600 column exactly; a phone keeps the 16. The vertical
          rhythm is the node's: 12 above the head, 51 between the head's rows
          (the search row's foot at 60 to the stories at 111).

          THE NODE'S DECK IS NOT DRAWN. 1328:1885 puts the wink deck and "Make
          some friends" between the stories and the list; ogazboiz took it
          off this page on 2026-09-12 — the deck is already on Home, and
          `/pals` is "just about friends and the rest that they are
          interested in" — and asked for the TOPIC ROW (647:16266) over the
          list instead, since the feed is here now. The row is the head's last
          child (composed in `pals-screen`, which owns the selection) and the
          list follows its rule on 24 — a judgement, since no frame draws this
          row on this page.

          Signed out there is no strip (its gate is `pals-screen`'s), so the
          row follows the search row on the same 51 rather than leaving a
          96-tall hole where a stranger's stories would be.
        */}
        <div className="flex min-h-[calc(100dvh-var(--ws-crumb-h)-var(--ws-topbar-h)-var(--ws-nav-h))] flex-col px-4 pb-6 pt-3 md:px-0">
          {headSlot}

          {/* Quoting a post from this list opens the composer where the
              reader is, directly over the list. */}
          {composer && <div className="mt-6 md:ml-[25px] md:w-[573.14px] md:max-w-[calc(100%-25px)]">{composer}</div>}

          {fresh.pinned && (
            <NewPostsPill count={fresh.count} authors={fresh.authors} onTap={fresh.merge} column={listRef} />
          )}

          {/*
            1344:21877 — 573.14 wide at the node's 25, cards 47.89 apart. On
            the 600 column that leaves 1.86 between the list's right edge and
            the column's: it is left as the file's slack, not stretched away.
            Narrower columns cap the list at what is left of them. The node's card is the
            shared `PostCard` at 0.7551 (573.14 / 759; its 0.52 stroke, 12.46
            radius and 47.89 gap are all `ws-post`'s times that); the card is
            not rescaled — the list takes the node's width and gap and the
            card keeps its own type.
          */}
          <div
            ref={listRef}
            className="mt-6 space-y-4 md:ml-[25px] md:w-[573.14px] md:max-w-[calc(100%-25px)] md:space-y-[47.89px]"
          >
            {!ready && <PostSkeleton />}
            {ready && gated && (
              <EmptyState
                glyph="◇"
                title="Sign in to see your pals' posts"
                body="This lane is what the people you follow are posting."
                action={
                  <button
                    onClick={login}
                    className="ws-btn-silver ws-press ws-btn-md rounded-full font-bold"
                  >
                    Sign in
                  </button>
                }
              />
            )}
            {searchSlot ?? (ready && !gated && listBody)}
          </div>
          {!gated && listTail}
        </div>

        {viewer}
      </>
    );
  }

  return (
    <>
      {/* One timeline, every width. Mobile used to get a full-viewport snap
          feed instead, which is why a text post arrived as a sentence floating
          in a wall of black and why the phone never had the reading surface
          the desktop did. Video moved to Explore's reels, where it is watched
          rather than scrolled past. */}
      {/* The ground is `#0F0F0F` and belongs to the shell's pane, not to this
          column — see AppShell. Painting it here left a seam beside the right
          rail. */}
      {/* `ws-align-logo`: under the dock, from md up, the left gutter goes so
          the stories start on the top bar lockup's line — see globals.css. */}
      <div className="ws-align-logo relative px-4 py-4 lg:px-6">
        {/* THE HEAD OF THE COLUMN — the search row (1295:142736), the banner
            11 under it (1305:149178 starts at 36487 against the row's 36476),
            then the column's own 64 to the first section. */}
        {headSlot && <div className="mb-10 flex flex-col gap-[11px]">{headSlot}</div>}

        {/*
          HOME STARTS AT THE STORIES — node 225:3315.

          Three things used to sit above them and none is in the file:

          · a `Schedule Stream` / `Create Post` pair. Composing is already
            global — the shell's floating `+` opens the composer on every
            surface that allows one — so this was a second entry point for the
            same act, occupying the first thing a reader sees.
          · the HALLWAY, whose whole job is now done by the rooms carousel
            below the tab row (225:3822). It was drawing its own empty state,
            so a square with no room open opened on "No gist rooms open" — an
            apology, at the top of the home page, for a quiet evening. The
            carousel renders NOTHING when nothing is open, which is the same
            information and costs no space.
          · `Trending discussions`, which is real and stays, but below the
            stories rather than above them — see its own note.

          What the file opens on is the people you follow, which is what a
          social page should say first.
        */}
        {/* The stories strip moved to Pals, above its tabs (ogazboiz,
            2026-09-11). Home opens on what the square is talking about. */}

        {/*
          TRENDING IS NOT IN THIS COLUMN ANY MORE.

          It was mounted here because the right rail is `hidden lg:block`, so
          a phone never saw it. That reason has gone: Home's field now answers
          a search in place, and typing a topic beats scanning four hashtags
          somebody else ranked (ogazboiz: "if they want to search ... remove it
          there because it doesnt make sense").

          It also cost the worst space on the smallest screen — between the
          banner and the first section the design actually draws — to show a
          block the design does not. It still lives in the RAIL and on
          Explore, which is where ambient discovery belongs: neither pushes
          the column down.
        */}

        {/*
          The arena banner is gone from Home.

          It is a green, full-width call to join a LIVE ARENA — another
          product, in another slice, shouting on the one page that is supposed
          to say what this place is. Between it, the Live badge on the story
          rail and a "Live Streaming" lane, Home read as a broadcast product.
          It is not one: "we don't do all those streaming thing".

          It keeps its home on /live, which is where somebody who wants an
          arena goes.
        */}

        {searchSlot ?? (
          <>
        {composer}

        {/* NODE 225:3822 — the rooms open right now, directly under the tabs.
            A room happening now beats a subject being discussed, and both beat
            a post from this morning. Renders nothing when none is open. */}
        {/* The section carries its own margins, so a quiet evening with no room
            open renders nothing at all rather than an empty spacer. */}
        {roomsSlot}

        {/* NODES 225:3526 + 225:3374 — "Make some friends". */}
        {/* Its own margins, like the rooms above it: a directory with nobody
            in it renders nothing and leaves no spacer. */}
        {friendsSlot}

        {/* Rooms that have not opened yet, directly under the deck. Its own
            margins, like the two sections above it: nothing scheduled renders
            nothing at all rather than an empty shelf. */}
        {comingSoonSlot}

        {/* node 1391:38132 — under Coming Soon, phones only: the rail carries
            it from lg up and two copies on one screen is not a placement. */}
        {mode === "home" && partnersSlot && (
          <div className="mb-10 lg:hidden">{partnersSlot}</div>
        )}

        {/* 1305:149179 — the houses anybody can join, closing the column's
            sections before the timeline. */}
        {housesSlot}

        {/* 1314:153017 — Home's posts, as a slide. "View more" on it opens
            /feed, which is this same component in `feed` mode. */}
        {mode === "home" && postsSlot}

        {/* NODE 540:19351 — the pals rail closes Home's column (it has no
            list to sit inside). "Join a community" (647:16515) is NOT on Home
            any more — Popular Houses is the same list, and ogazboiz asked for
            the last section to go (2026-09-12); on /feed both stay interleaved
            into the timeline where the file puts them. */}
        {mode === "home" && palsSlot}
          </>
        )}

        {/* 38 between cards, measured between the two slabs' outer edges in
            the Home frame (496:13048). It was 16, which read as a stack rather
            than as separate objects — and these are objects, not rows. */}
        {/* Floats over the column, fixed under the top bars, only while the
            reader is scrolled away from the head — at the top the held posts
            merge in place and there is nothing to announce. */}
        {mode === "feed" && fresh.pinned && (
          <NewPostsPill count={fresh.count} authors={fresh.authors} onTap={fresh.merge} column={listRef} />
        )}
        {/* 647:16354 spaces the timeline 73 apart around cards drawn 873.65 wide; the
            card here is that drawing at 759 (see PostCard), so 73/1.151 = 63.42. */}
        {mode === "feed" && (
        <div ref={listRef} className="space-y-4 md:space-y-[63.42px]">
          {listBody}
        </div>
        )}

        {mode === "feed" && listTail}

        {/* The floating compose button used to live here, which is why it
            existed on home and nowhere else. AppShell owns it now and renders
            it on every surface that allows composing — see allowsCompose. The
            in-timeline composer below stays: the stories rail and the empty
            states open it in place via `?compose=1` / `?compose=story`. */}
      </div>

      {viewer}
    </>
  );
}
