"use client";

import Link from "next/link";
import { HouseMemberTile } from "@/components/layout/house-member-tile";
import { EmptyPanel } from "@/components/ui/empty-panel";
import { ErrorState } from "@/components/ui/states";
import { Spinner } from "@/components/ui/button";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useMe } from "@/hooks/use-me";
import { useProfileViews } from "@/features/profile/hooks/use-profile-views";
import { relativeTime } from "@/lib/format";
import { profileHref } from "@/lib/profile-href";
import { sq } from "@/lib/square-path";

/**
 * WHO VIEWED YOUR PROFILE — node 1285:36433's people row, as a panel.
 *
 * The file draws it as "Members": a row of 104-wide tiles 24 apart, each a
 * 104 x 113 photo at a 32 radius with the wink and follow discs overlapping its
 * foot, the name 8 below at 14/24 centred, and a "View all" tile closing the
 * row. This IS the view-all, so the row becomes a wrapping grid and that last
 * tile has nowhere to go.
 *
 * ─── IT IS THE SAME TILE, NOT A SECOND ONE ──────────────────────────────────
 * `HouseMemberTile` is already that node's geometry, down to the exported
 * glyphs and the two follow states, so this surface composes it rather than
 * drawing a look-alike. Two tiles for one object is how one of them ends up
 * with the wrong follow behaviour.
 *
 * ─── THE ONE THING THIS SURFACE ADDS ────────────────────────────────────────
 * WHEN they came by, as the tile's `meta` line. The service moves `viewedAt` at
 * most once per UTC day, so it is "the last day they looked", never a visit
 * count — and the copy says "Viewed" rather than anything that implies a tally.
 *
 * ─── FOUR OUTCOMES, AND TWO OF THEM ARE NOT ERRORS ──────────────────────────
 * Private browsing is a refusal the reader chose, and it gets the screen that
 * says so plus the way back. A route that is not deployed goes quiet. Only a
 * real failure draws a retry.
 */
export function ProfileViewers({ isMe }: { isMe: boolean }) {
  const views = useProfileViews(isMe);
  const me = useMe();
  const sentinel = useInfiniteScroll(
    () => views.fetchNextPage(),
    Boolean(views.hasNextPage && !views.isFetchingNextPage)
  );

  if (!isMe) return null;

  /*
    THE RECIPROCAL BARGAIN, SAID PLAINLY.

    This is not an error and must not read as one: the reader turned private
    browsing on, and the trade is that they cannot see their own list while it
    is. The way out is one tap away and is named, because a refusal whose remedy
    is hidden is indistinguishable from a broken feature.
  */
  if (views.isPrivate) {
    return (
      <div className="pt-6">
        <EmptyPanel
          title="You're browsing privately"
          body="Nobody is recorded as a viewer while this is on — including you, on other people's profiles. Turn it off to see who viewed yours. Nothing was lost: the list comes back with everyone in it."
          action={
            /* `profileHref` builds the path from the profile ID, not the
               handle somebody can change under the link — the same helper the
               shell's own settings entry uses. It waits for `/me` rather than
               guessing a path that would 404. */
            me.data ? (
              <Link
                href={sq(profileHref(me.data, "settings"))}
                /* Settings is a heavy route and this is one empty-state
                   action, not a row — there is nothing to gain by fetching it
                   before anybody asks. */
                prefetch={false}
                className="ws-btn-silver ws-btn-md ws-press rounded-full font-bold"
              >
                Open settings
              </Link>
            ) : undefined
          }
        />
      </div>
    );
  }

  // Not deployed here. Quiet, rather than a claim that nobody looked.
  if (views.unavailable) return null;

  if (views.isError) {
    return (
      <div className="pt-6">
        <ErrorState
          error={null}
          fallback="Couldn't load who viewed your profile."
          onRetry={() => void views.refetch()}
        />
      </div>
    );
  }

  if (views.isPending) {
    return (
      <div className="flex flex-wrap gap-6 pt-6" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[149px] w-[104px] animate-pulse rounded-[32px] bg-white/5" />
        ))}
      </div>
    );
  }

  if (views.entries.length === 0) {
    return (
      <div className="pt-6">
        <EmptyPanel
          title="Nobody yet"
          body="When somebody spends a moment on your profile, they show up here. The last 90 days."
        />
      </div>
    );
  }

  return (
    <section className="pt-6" aria-label="Who viewed your profile">
      {/*
        The count is the service's `total` — people in the 90-day window, on
        every page — never the number of rows that happen to be loaded.
      */}
      <p className="pb-4 text-[12px] font-bold leading-4 text-grey-100">
        {views.total === null
          ? "Viewed your profile"
          : `${views.total.toLocaleString()} ${views.total === 1 ? "person" : "people"} in the last 90 days`}
      </p>

      {/* The node's own row rhythm — 24 between tiles — allowed to wrap. */}
      <ul className="flex flex-wrap gap-6">
        {views.entries.map((entry) => (
          <HouseMemberTile
            key={entry.viewer.id}
            profile={entry.viewer}
            meta={`Viewed ${relativeTime(entry.viewedAt)}`}
          />
        ))}
      </ul>

      <div ref={sentinel} className="h-px" />
      {views.isFetchingNextPage && (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      )}
    </section>
  );
}
