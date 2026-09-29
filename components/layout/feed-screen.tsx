"use client";

import { FeedPage, type Post } from "@/features/feed";
import { FollowPill, WinkButton } from "@/features/profile";
import { useCoinBalance } from "@/features/gifts";
import { TipButton } from "@/features/tips";
import { JoinACommunity } from "@/components/layout/join-a-community";
import { SuggestedPals } from "@/components/layout/suggested-pals";
import type { Profile } from "@/lib/api/schemas";

/**
 * THE TIMELINE, ON ITS OWN PAGE.
 *
 * Home stopped showing a scrolling feed on 2026-09-12: the design draws six
 * sections and no list, and the "Post For You" rail was showing the same lane
 * the list under it already had. "View more" on that rail opens this.
 *
 * It is `FeedPage` in `feed` mode — the same component Home renders, so the
 * composer, the new-posts pill, the infinite scroll and the full-screen video
 * viewer are the ones that always existed rather than a second copy.
 *
 * Deliberately NOT in the sidebar: Home was asked to stop leading with the
 * feed, and a nav row would put it back in front of everyone by another door.
 */
const followSlot = (author: Profile) => <FollowPill profile={author} variant="header" />;
const winkSlot = (author: Profile) => <WinkButton profile={author} size="post" />;

export function FeedScreen() {
  /*
    THE COIN BALANCE IS COMPOSED IN HERE, not read inside the button.

    `TipButton` lives in the tips slice and the balance belongs to gifts;
    slices never import each other, so the layer that is allowed to know both
    supplies it — the same reason `FollowPill` and the wink arrive as slots.

    It moved from a module-level `tipSlot` const because that cannot call a
    hook. The query is small, cached and shared with every other coin surface,
    so asking for it with the feed costs one request per session rather than
    one per sheet.
  */
  const coins = useCoinBalance();
  const tipSlot = (post: Post) => (
    <TipButton
      target={{ kind: "post", id: post.id, recipient: post.author }}
      balanceCoins={coins}
      variant="post"
    />
  );

  return (
    <FeedPage
      mode="feed"
      followSlot={followSlot}
      winkSlot={winkSlot}
      tipSlot={tipSlot}
      communitySlot={<JoinACommunity />}
      palsSlot={<SuggestedPals />}
    />
  );
}
