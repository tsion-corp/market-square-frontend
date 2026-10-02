"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { RowSkeleton } from "@/components/ui/skeleton";
import { usePeople } from "@/features/discovery";
import { useMe } from "@/hooks/use-me";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { cn } from "@/lib/cn";
import type { Profile } from "@/lib/api/schemas";

/**
 * WHO MAY WALK INTO A PRIVATE ROOM THAT HAS NO HOUSE.
 *
 * A private gist room used to mean exactly one thing: private to the house it
 * was opened from. So from the `+` menu — where there is no house — Private was
 * unavailable, because there was nobody for it to be private TO.
 *
 * `guests` on `POST /streams` is what changes that: a room can now be private
 * to a LIST of people chosen before it exists. The service's listing filter has
 * three doors (the host, the house's members, and a guest row), so a house-less
 * private room is reachable by its host and the people picked here, and by
 * nobody else.
 *
 * ─── WHY IT LIVES IN components/layout ───────────────────────────────────────
 * The directory is the discovery slice's (`usePeople`) and this is rendered by
 * the houses slice's composer; slices never import each other. So it is
 * composed here and handed down as a slot, the same way `home-screen` joins
 * profile's follow control into the feed.
 *
 * ─── IT IS NOT A SHEET ───────────────────────────────────────────────────────
 * The two existing people pickers are each their own `Sheet`. This one is
 * inline, because it is a FIELD of a form that is already in a sheet, and a
 * sheet over a sheet buries the thing being filled in. The row, its avatar and
 * its follower line are deliberately the same as those pickers' — the same
 * object should look the same wherever somebody is choosing a person.
 */
export function GuestPicker({
  value,
  onChange,
  max,
}: {
  /** The chosen profile ids, in the order they were picked. */
  value: string[];
  onChange: (next: string[]) => void;
  /** The service's own ceiling for one create. */
  max: number;
}) {
  const [query, setQuery] = useState("");
  const me = useMe();
  const people = usePeople(query, "followers");
  const sentinel = useInfiniteScroll(
    () => people.fetchNextPage(),
    Boolean(people.hasNextPage && !people.isFetchingNextPage)
  );

  /*
    You are not a guest of your own room. The service names the host as its own
    door in the listing filter, so a row for yourself would be a no-op that
    reads as broken — the same rule the People directory applies to your row.
  */
  const items = (people.data?.pages.flatMap((page) => page.items) ?? []).filter(
    (profile) => !me.data || profile.id !== me.data.id
  );

  const full = value.length >= max;

  const toggle = (profile: Profile) => {
    if (value.includes(profile.id)) {
      onChange(value.filter((id) => id !== profile.id));
      return;
    }
    // Refused at the ceiling rather than silently trimmed on submit: an
    // unknown id refuses the whole create on the service, and a list quietly
    // shortened here would open a room missing somebody the host chose.
    if (full) return;
    onChange([...value, profile.id]);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-white">Who can join</span>
        <span className="text-[12px] text-white/50">
          {value.length === 0 ? `Up to ${max}` : `${value.length} of ${max}`}
        </span>
      </div>

      {/* The composer's own 40px field, so this reads as one more row of the
          form rather than a borrowed control from another surface. */}
      <label className="sr-only" htmlFor="room-guests-search">
        Search people
      </label>
      <input
        id="room-guests-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search people…"
        className="w-full rounded-[30px] border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[14px] text-white outline-none placeholder:text-white/50"
      />

      <div className="flex max-h-[38vh] flex-col gap-2 overflow-y-auto">
        {people.isPending && [0, 1, 2].map((i) => <RowSkeleton key={i} />)}

        {people.isError && (
          <ErrorState
            error={people.error}
            fallback="Couldn't load people."
            onRetry={() => people.refetch()}
          />
        )}

        {people.isSuccess && items.length === 0 && (
          <EmptyState
            glyph="◇"
            title={query.trim() ? "No matches" : "Nobody to show yet"}
            body={
              query.trim()
                ? "No one here matches that name."
                : "The directory is empty right now."
            }
          />
        )}

        {items.map((profile) => {
          const name = profile.displayName ?? profile.username;
          const on = value.includes(profile.id);
          return (
            <button
              key={profile.id}
              type="button"
              aria-pressed={on}
              // Only the unpicked rows go dead at the ceiling — somebody who
              // has chosen their limit must still be able to take one back out.
              disabled={full && !on}
              onClick={() => toggle(profile)}
              className={cn(
                "ws-press flex h-[54.5px] items-center gap-[9px] rounded-xl border bg-white/[0.03] px-3 text-left transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40",
                on ? "border-white/40" : "border-white/10"
              )}
            >
              <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-[25%] border border-white/20 bg-white/10">
                <Avatar name={name} seed={profile.id} src={profile.avatarUrl} size={38} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[12px] font-bold leading-4 text-white">{name}</span>
                <span className="truncate text-[11px] leading-[16.5px] text-white/50">
                  {profile.followerCount > 0
                    ? `${profile.followerCount.toLocaleString()} followers`
                    : `@${profile.username}`}
                </span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                  on ? "border-white bg-white text-black" : "border-white/40"
                )}
              >
                {on && "✓"}
              </span>
            </button>
          );
        })}

        <div ref={sentinel} />
        {people.isFetchingNextPage && (
          <div className="flex justify-center py-4">
            <Spinner className="h-5 w-5 text-meta" />
          </div>
        )}
      </div>
    </div>
  );
}
