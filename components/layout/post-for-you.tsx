"use client";

import { useRouter } from "next/navigation";
import { FeedItemCard, useFeed } from "@/features/feed";
import type { Post, Profile } from "@/lib/api/schemas";
import { SectionHeading } from "@/components/layout/section-heading";
import { Skeleton } from "@/components/ui/skeleton";
import { sq } from "@/lib/square-path";

/** The design shows ten before the pill takes over (ogazboiz, 2026-09-12). */
const SHOWN = 10;

/**
 * A text-only post shorter than this leaves the media card mostly empty, and
 * everyone sees this rail on Home — so it does not belong here. Posts WITH
 * media always qualify (the media fills the card); a text-only post only earns
 * a slot once it has enough words to fill one. Tune this one number to be
 * stricter or looser.
 */
const MIN_TEXT_ONLY_CHARS = 80;

/**
 * POST FOR YOU — node 1314:153017, the last section of the 2026-09-12 Home.
 *
 * A sideways rail of the SAME post card the timeline draws, after Popular
 * Houses. The file's own numbers: the heading over a row at gap 17.37, cards
 * 467.6 wide against its 573 column, aligned to the bottom.
 *
 * ─── IT SITS ABOVE THE TIMELINE, IT DOES NOT REPLACE IT ──────────────────────
 * The design's Home frame draws these six sections and no scrolling feed, which
 * would read as the rail replacing the timeline. It does not: ogazboiz was
 * asked directly and kept the timeline ("slide above, timeline stays"). So this
 * is a taste of the lane — ten posts and a View more — and the feed continues
 * underneath exactly as it did.
 *
 * ─── ONE POST CARD, TWO SURFACES ─────────────────────────────────────────────
 * `FeedItemCard` unchanged, with the same four slots Home already hands the
 * timeline, so a post looks and behaves identically in both places and a fix to
 * one is a fix to both. A second post card built for a rail is how the two
 * quietly drift apart — and it would have to reimplement the media viewer, the
 * quote flow, the tallies and the three identity chips to do it.
 *
 * The card is fluid, so it takes the rail's width rather than the column's —
 * with `compact`, which drops the inline reply field. Capped at the file's 220
 * and with no floor, that field collapses to an untypable sliver once the
 * tallies and the four controls have taken their width; and a rail is the wrong
 * place to reply anyway. Tapping the card opens the post, where the field is.
 */
export function PostForYou({
  followSlot,
  winkSlot,
  tipSlot,
}: {
  followSlot?: (author: Profile) => React.ReactNode;
  winkSlot?: (author: Profile) => React.ReactNode;
  tipSlot?: (post: Post) => React.ReactNode;
}) {
  const router = useRouter();
  // The same lane the timeline below reads, so the query is shared rather than
  // fetched twice.
  const feed = useFeed("for-you");
  const items = (feed.data?.pages.flatMap((page) => page.items) ?? [])
    .filter((item) => {
      // A post carries the media card on its media; a text-only post has to
      // carry it on words alone, and a short one leaves the card half-empty —
      // so drop the short text-only posts and keep media posts (any caption)
      // and text posts long enough to fill the card. Streams and activities
      // draw their own card and are always kept.
      if (item.type !== "post" || !item.post) return true;
      const hasMedia = Boolean(item.post.mediaUrl || item.post.media?.length);
      return hasMedia || (item.post.text?.trim().length ?? 0) >= MIN_TEXT_ONLY_CHARS;
    })
    .slice(0, SHOWN);

  // Nothing to show is no section — never an empty shelf above a timeline that
  // is also empty.
  if (!feed.isPending && items.length === 0) return null;

  return (
    <section aria-labelledby="post-for-you" className="mb-10">
      <div className="mb-4">
        <SectionHeading
          id="post-for-you"
          lead="Post For You"
          action={{ label: "View more", href: sq("/feed") }}
        />
      </div>

      <div className="flex items-end gap-[17.37px] overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {feed.isPending
          ? [0, 1].map((index) => (
              <div key={index} className="w-113.5 shrink-0">
                <Skeleton className="h-[367px] w-full rounded-[16.5px]" />
              </div>
            ))
          : items.map((item) => (
              <div key={item.id} className="h-[367px] w-113.5 max-w-[85vw] shrink-0">
                <FeedItemCard
                  item={item}
                  followSlot={followSlot}
                  winkSlot={winkSlot}
                  tipSlot={tipSlot}
                  // Tapping a card opens the full /feed with THIS post pinned
                  // first — "see more", starting from the one you chose.
                  onOpenPost={(post) => router.push(sq(`/feed?post=${post.id}`))}
                  compact
                />
              </div>
            ))}
      </div>
    </section>
  );
}
