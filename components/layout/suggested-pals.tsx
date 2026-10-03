"use client";

import Link from "next/link";
import { useSettings } from "@/features/settings";
import { profileHref } from "@/lib/profile-href";
import { PalCard, RAIL_CARD } from "@/components/layout/pal-card";
import { usePeople } from "@/features/discovery";
import { DECK_SORT } from "@/lib/people-filters";
import { useMe } from "@/hooks/use-me";
import type { Profile } from "@/lib/api/schemas";

/** How many the rail asks for. The file draws twelve and clips at six. */
const WANTED = 12;

/**
 * "SUGGESTED PALS TO FOLLOW NEARBY YOU" — node 540:19351.
 *
 * A horizontal rail of pal cards a few posts into the timeline. Same card as
 * "Make some friends" (`PalCard`), laid flat instead of fanned: 170.41 wide on
 * a 12 gap, headed by a 19.53/24.86 title and a 10.65/14.21 line at 40% white,
 * 18.11 above the cards.
 *
 * The file draws twelve cards in a 1085 window that shows six. That is a rail
 * you scroll, not a grid, so it scrolls — and it scrolls with the column rather
 * than being clipped to a fixed width, because our column is not 1085.
 *
 * ─── "NEARBY" IS A PLACE NAME, NEVER A DISTANCE ─────────────────────────────
 * It asks `GET /profiles?city=<the viewer's own city>`. There is no radius, no
 * coordinate and no `distanceKm` anywhere in this path and there must not be:
 * a city somebody typed about themselves is a fact they chose to publish, while
 * a distance to a stranger is their position, recomputed every time you look.
 * `lib/people-filters.ts` carries the same rule for Explore's filters.
 *
 * ─── IT RENDERS NOTHING UNTIL IT CAN HONESTLY SAY "NEARBY" ──────────────────
 * With no city on the viewer's own profile there is no place to ask about, and
 * the rail is absent rather than quietly showing a general list under a heading
 * that promises a local one. Dropping the facet would not be graceful
 * degradation, it would be the section lying about what it is.
 *
 * (`GET /me` does carry `city`: the spec's `Profile` is an `allOf` over
 * `PublicProfile` plus the private half, so reading its own `properties` finds
 * nothing while city, region and gender are inherited. Worth knowing before
 * concluding a field is missing from this API.)
 *
 * `excludeFollowing=true` keeps people the viewer already follows out of a rail
 * whose whole proposition is people to follow. Server-side, because filtering
 * the loaded page here costs a row per page that no cursor can top back up.
 */
export function SuggestedPals() {
  const me = useMe();
  /*
    THIS RAIL IS PLACE PERSONALISATION, so it obeys the setting that governs it.

    It asks for people in the viewer's own city. That is exactly what
    "Personalize based on places" turns off, and a rail that keeps doing it
    after somebody switched the setting off makes the settings screen a lie —
    the same gap the pals DECK had, where two surfaces used one fact about a
    person and only one of them asked.

    Undefined is not "off": a service that does not carry the field has not
    been asked, and defaulting a privacy answer to the restrictive side here
    would silently remove a working section for everybody on an older service.
  */
  const settings = useSettings();
  const placeAllowed = settings.data?.privacy?.personalizeByPlace !== false;
  const city = me.data?.city?.trim() ?? "";
  /*
    RANKED, NOT MERELY POPULAR — the same `foryou` the friends deck uses.

    This asked for `followers`, so a rail headed "Suggested Pals" was the
    most-followed people who happened to share a city, in follower order.
    Nothing about it was a suggestion: the same list for everybody in a city,
    and the loudest accounts at the front of it.

    `foryou` is the service's own ranking — shared interests, place, activity,
    and people who have winked the reader first. The city facet stays, because
    the heading promises nearby and the service treats an explicit facet as the
    reader's request rather than as personalisation. So it is a RANKED list
    narrowed to a place, instead of a popularity list that is only narrowed.

    Nothing here may depend on what `foryou` returns today; the bands behind it
    are the service's to change and every change lands without a release.
  */
  const people = usePeople("", DECK_SORT, Boolean(city) && placeAllowed, {
    city,
    excludeFollowing: true,
  });

  const items: Profile[] = (people.data?.pages ?? [])
    .flatMap((page) => page.items)
    .slice(0, WANTED);

  /*
    TURNED OFF, OR NOBODY TO SHOW: absent, and that is right. The rail is a
    suggestion; a skeleton for a section nobody asked for is worse than silence,
    and somebody who switched place personalisation off asked for exactly this.
  */
  if (!placeAllowed || (city && items.length === 0)) return null;

  /*
    NO CITY ON THE PROFILE — and this used to be silence too, which is how
    ogazboiz ended up saying "i cant see the pals" with nothing on screen to
    explain it.

    The original reasoning stands and is not being undone: showing a GENERAL
    list under a heading that promises a local one would be the section lying
    about what it is. But "do not lie" and "say nothing at all" are different
    answers, and only one of them tells somebody what to do about it. The
    heading is dropped along with the list, so nothing promises nearby people;
    what is left is the one line that makes the rail appear.
  */
  if (!city) {
    return (
      <section aria-label="Suggested pals">
        <h2 className="text-[19.5px] font-medium leading-[24.9px] text-white">
          Find pals near you
        </h2>
        <p className="mt-[0.9px] text-[10.65px] font-bold leading-[14.2px] text-white/40">
          Add your city and we&apos;ll show people around you.
        </p>
        {/*
          THE PROFILE, not settings. City is a profile field — it is edited in
          the profile sheet, and `/settings` is not even a route (settings live
          at `/u/<username>/settings`). A prompt that lands somewhere without
          the field it names is worse than no prompt.
        */}
        {me.data && (
          <Link
            href={profileHref(me.data)}
            /* The repo's rule for every profile link: a page's worth of
               JavaScript per link is not worth paying before somebody taps. */
            prefetch={false}
            className="ws-press mt-[18px] inline-flex rounded-full border border-white/20 px-4 py-1.5 text-[13px] font-bold text-body transition-colors hover:bg-white/10"
          >
            Add your city
          </Link>
        )}
      </section>
    );
  }

  return (
    <section aria-label="Suggested pals to follow nearby you">
      <h2 className="text-[19.5px] font-medium leading-[24.9px] text-white">
        Suggested Pals to follow nearby you
      </h2>
      {/* 10.65/14.21 at 40% white, and BOLD — the file sets the small line
          heavier than the title it sits under, which is unusual enough to be
          worth saying out loud. */}
      <p className="mt-[0.9px] text-[10.65px] font-bold leading-[14.2px] text-white/40">
        Wink at them or follow them later.
      </p>
      {/*
        `-mx-*` then padding: the rail runs to the card's edges as the file
        draws it, but its first and last cards keep the column's own inset, so
        nothing is flush against the border when it is scrolled to either end.
        `overflow-x-auto` clips BOTH axes, so the cards' shadows are not part of
        this box — they are inside the card's own bounds.
      */}
      <div className="mt-[18px] flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((profile) => (
          <PalCard key={profile.id} profile={profile} geometry={RAIL_CARD} />
        ))}
      </div>
    </section>
  );
}
