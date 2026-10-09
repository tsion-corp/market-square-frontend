"use client";

import { useState } from "react";

import { FeedPage, ArkmarksPage, PostDetailPage, type Post } from "@/features/feed";
import { FollowPill, WinkButton } from "@/features/profile";
import { useCoinBalance } from "@/features/gifts";
import { TipButton } from "@/features/tips";
import { HomeTopRow } from "@/components/layout/home-top-row";
import { HomeSearch } from "@/components/layout/home-search";
import { HomeBanner } from "@/components/layout/home-banner";
import { ProfileCompletenessBanner } from "@/components/layout/profile-completeness-banner";
import { LiveGistRooms } from "@/components/layout/live-gist-rooms";
import { FriendsDeck } from "@/components/layout/friends-deck";
import { ComingSoonRooms } from "@/components/layout/coming-soon-rooms";
import { PopularHouses } from "@/components/layout/popular-houses";
import { EcosystemPartnersRail } from "@/components/layout/ecosystem-partners-rail";
import { PostForYou } from "@/components/layout/post-for-you";
import { SuggestedPals } from "@/components/layout/suggested-pals";

// Slices never import each other, so the follow control — which belongs to the
// profile slice — is composed into the timeline here, the same way the stream
// room gets its own. Both home surfaces share the one slot.
const followSlot = (author: Parameters<typeof FollowPill>[0]["profile"]) => (
  <FollowPill profile={author} variant="header" />
);

// The tip control belongs to the tips slice for the same reason, and is joined
// in beside the follow pill on every post header. It takes the post, not the
// author: `POST /posts/:id/tips` credits the author but is addressed to the
// post, and the sheet needs the author only to name who is being paid.
// The tip sheet shows the reader what they HAVE while they choose what to
// send, and gives them a way to top up when it is short. The balance belongs to
// the kash slice, so it is joined in here rather than imported across — the
// same route slot the follow control above uses. It renders nothing at all
// where there is no wallet or no engine, which is the honest answer.

// The wink sits between the tip and the follow on every post header — node
// 496:13389 draws all three. It belongs to the profile slice, which owns the
// rate limit and the refusal copy, so it arrives the same way the other two do.
const winkSlot = (author: Parameters<typeof WinkButton>[0]["profile"]) => (
  <WinkButton profile={author} size="post" />
);


/**
 * The three post-header controls, for every screen that hands the feed slice
 * a list to draw — Home, Arkmarks, a post, and `/pals`' following lane. One
 * composition, exported, so the pals screen does not carry a second copy of
 * the slice-joining above.
 */
/*
  A HOOK, NOT A CONST, because one of the three now needs a balance.

  `tipSlot` opens the room's gift sheet, which is priced in COINS and shows
  what the reader holds — so it needs a number that only a hook can fetch. A
  module-level object cannot call one.

  The other two are unchanged and still pure. Exported as one hook rather than
  splitting them so a caller still gets the whole header in one spread, which
  is the thing this export existed for.
*/
export function usePostSlots() {
  /*
    The coin balance belongs to the gifts slice and `TipButton` to tips; slices
    never import each other, so the layer allowed to know both supplies it —
    the same reason `FollowPill` and the wink arrive as slots. The query is
    small, cached and shared with every other coin surface.
  */
  const coins = useCoinBalance();
  const tipSlot = (post: Post) => (
    <TipButton
      target={{ kind: "post", id: post.id, recipient: post.author }}
      balanceCoins={coins}
      variant="post"
    />
  );
  return { followSlot, winkSlot, tipSlot };
}

/**
 * Home, composed — node 225:3315.
 *
 * The file's order is stories, the TOPIC row, the rooms open now, "Make some
 * friends", the timeline, then "Join a community". Three of those read slices
 * the feed may not import, so they are assembled here and handed down as slots
 * — the same route-slot pattern the follow pill and the tip button above use.
 *
 * The column opens on the search row and the gistroom banner (1295:142736,
 * 1305:149178), for everybody: the banner is the strongest invitation on the
 * page, and the tap gates a signed-out reader into sign-in.
 *
 * The topic vocabulary is DATA rather than a node, because the row's selection
 * drives the feed's own query: `GET /topics` belongs to the discovery slice and
 * `GET /feed?topics=` is the feed's, and this is the one layer allowed to know
 * both.
 */
export function HomeScreen() {
  const { tipSlot } = usePostSlots();
  /*
    HOME ANSWERS ITS OWN SEARCH.

    The field was a link into Explore, which meant every search left the page
    the reader was on. ogazboiz: "that search is not suppose to take me to
    discover ... everything that i am searching for suppose to be there even
    room codes ... in that home that search there".

    So Home owns the string, and while it is non-empty the sections give way
    to the results. It is deliberately LOCAL state rather than `?q=` in the
    URL: Explore owns `?q=`, and a second writer of the same parameter is how
    two surfaces start fighting over one query. Clearing the field restores
    the page exactly as it was.
  */
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  // Home's own eight, in the design's order (`?surface=home`).
  return (
    <FeedPage
      mode="home"
      followSlot={followSlot}
      winkSlot={winkSlot}
      tipSlot={tipSlot}
      headSlot={
        <>
          <HomeTopRow value={query} onChange={setQuery} />
          {!searching && (
            <>
              {/*
                ABOVE the marketing banner, and that order is the point: a
                reader's own unfinished profile outranks anything we want to
                tell them. It renders nothing at 100%, for a signed-out
                visitor, or once dismissed, so most readers never see it and
                the row below keeps its place.
              */}
              <div className="mt-4">
                <ProfileCompletenessBanner />
              </div>
              <div className="mt-4">
                <HomeBanner />
              </div>
            </>
          )}
        </>
      }
      searchSlot={searching ? <HomeSearch query={query} /> : undefined}
      roomsSlot={<LiveGistRooms />}
      friendsSlot={<FriendsDeck />}
      comingSoonSlot={<ComingSoonRooms />}
      partnersSlot={<EcosystemPartnersRail heading={false} />}
      housesSlot={<PopularHouses />}
      postsSlot={<PostForYou followSlot={followSlot} winkSlot={winkSlot} tipSlot={tipSlot} />}
      palsSlot={<SuggestedPals />}
    />
  );
}

export function ArkmarksScreen() {
  const slots = usePostSlots();
  return <ArkmarksPage {...slots} />;
}

export function PostScreen({ postId }: { postId: string }) {
  const slots = usePostSlots();
  return (
    <PostDetailPage
      postId={postId}
      {...slots}
    />
  );
}
