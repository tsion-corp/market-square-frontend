"use client";

import { cn } from "@/lib/cn";
import { useGate } from "@/hooks/use-gate";
import { useMe } from "@/hooks/use-me";
import { Avatar } from "@/components/ui/avatar";
import { IconBell } from "@/components/ui/icons";
import type { Profile } from "@/lib/api/schemas";
import { useFollow, useFollowersList } from "@/features/profile/hooks/use-profile";
import { useIsFollowing } from "@/features/profile/lib/follow-state";

/**
 * THE PROFILE'S FOLLOW ROW — node 2112:19612, under the bio and counts on
 * SOMEBODY ELSE's profile.
 *
 * The file draws it in two halves:
 *   · left  — the mutual-follower proof ("Followed by …, and 30 more")
 *   · right — notify · message · Follow, three controls on a 6%-white ground
 *
 * ─── WHAT IS REAL, AND WHAT WAITS FOR THE BACKEND ────────────────────────────
 * Follow and Message are the slice's own live actions. Two things in the file
 * have no service behind them yet, and the house rule is to draw neither as a
 * control that lies:
 *
 *   · THE MUTUAL-FOLLOWER PROOF needs a "who, among the people I follow, follows
 *     them" edge. `GET /profiles/:id/followers` is a plain paged list, and
 *     intersecting it with the viewer's following client-side is exactly the
 *     fabricated directory the repo deleted once already. So the left half is
 *     ABSENT until the service carries the mutuals — never invented names.
 *   · THE BELL is per-person post notifications, which the service does not
 *     have. It is drawn, because the file draws it, but genuinely `disabled`
 *     with the reason on it — the flagged-capability rule — rather than a live
 *     control that saves nothing.
 *
 * ─── THE FOLLOW PILL PERSISTS BOTH STATES ────────────────────────────────────
 * Unlike the feed's `FollowPill`, which vanishes once you follow (a quick-follow
 * invitation among a person's posts), THIS is where unfollowing lives — so it
 * stays as "Following" and toggles. The behaviour is the shared `useFollow` /
 * `useIsFollowing`, so a missing edge can never render a fabricated "Following".
 *
 * Absent on your own profile: you do not follow, message or notify yourself.
 */
export function ProfileActionRow({
  profile,
  /** The messages slice's own control, composed in — slices never import each other. */
  messageSlot,
}: {
  profile: Profile;
  messageSlot?: (profile: Profile) => React.ReactNode;
}) {
  const me = useMe();
  const follow = useFollow(profile);
  const gate = useGate();
  const isFollowing = useIsFollowing(profile);
  // The people to show on the left — this profile's own followers (real, paged),
  // the first three as a face pile with the rest counted. Hook runs before any
  // early return.
  const followers = useFollowersList(profile.id);
  const people = (followers.data?.pages.flatMap((page) => page.items) ?? []).filter(
    (person) => person.id !== me.data?.id
  );
  const shown = people.slice(0, 3);
  const rest = Math.max(0, (profile.followerCount ?? people.length) - shown.length);

  // Your own profile has no follow/message/notify row.
  if (me.data?.id === profile.id) return null;

  return (
    <div className="flex items-center justify-between gap-3">
      {/* LEFT — who follows this person: a face pile of the first three, then
          the names and how many more (node 2112:19612). Real followers from the
          paged list; absent (an empty span keeping justify-between) until any
          have loaded, never a fabricated set. */}
      {shown.length > 0 ? (
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="flex shrink-0 items-center">
            {shown.map((person, index) => (
              <span
                key={person.id}
                className={cn(
                  "overflow-hidden rounded-full border border-white shadow-[0px_4px_15px_0px_rgba(147,147,147,0.25)]",
                  index > 0 && "-ml-2"
                )}
              >
                <Avatar
                  name={person.displayName || person.username}
                  seed={person.id}
                  src={person.avatarUrl}
                  size={20}
                  sizeClassName="h-5 w-5"
                  className="rounded-none border-0"
                />
              </span>
            ))}
          </span>
          <p className="min-w-0 truncate text-[12px] font-medium leading-4">
            <span className="text-white/40">Followed by </span>
            <span className="text-white/80">
              {shown.map((person) => person.displayName || person.username).join(", ")}
              {rest > 0 ? ` and ${rest} more` : ""}
            </span>
          </p>
        </div>
      ) : (
        <span />
      )}

      <div className="flex shrink-0 items-center gap-[7px]">
        {/* NOTIFY — visible but inert: no per-person post-notification exists. */}
        <button
          type="button"
          disabled
          aria-label="Notify me about their posts"
          title="Post notifications aren't available yet."
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <IconBell className="h-4 w-4" />
        </button>

        {messageSlot?.(profile)}

        {/* FOLLOW / FOLLOWING — persists both states; unfollowing lives here. */}
        <button
          type="button"
          aria-pressed={isFollowing}
          onClick={() => gate(() => follow.mutate(!isFollowing))}
          className={cn(
            "ws-press flex h-7 min-w-[118px] items-center justify-center rounded-full px-4 text-[13px] font-semibold transition-colors",
            isFollowing
              ? "bg-white/[0.06] text-white hover:bg-white/10"
              : "bg-accent text-ink hover:bg-white"
          )}
        >
          {isFollowing ? "Following" : "Follow"}
        </button>
      </div>
    </div>
  );
}
