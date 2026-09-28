"use client";

import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { useWink, useFollow, useIsFollowing } from "@/features/profile";
import { useGate } from "@/hooks/use-gate";
import { useMe } from "@/hooks/use-me";
import { profileHref } from "@/lib/profile-href";
import { asset, sq } from "@/lib/square-path";
import { cn } from "@/lib/cn";
import type { Profile } from "@/lib/api/schemas";

/**
 * ONE MEMBER OF A HOUSE — node 1285:36955's tile (`Frame 2147225667`).
 *
 * 104 wide: a 104 x 113 photo at a 32 radius, then the name 8 below at 14/24,
 * centred. Two 24 controls sit in a 56-wide row centred on the photo's bottom
 * edge, 8 apart, overlapping it by 12 and hanging 12 below — which is why the
 * group is 125 tall against the photo's 113.
 *
 * ─── THE TWO BADGES ARE CONTROLS, NOT DECORATION ─────────────────────────────
 * I skipped them the first time because I could not tell what they were, and
 * that was the wrong call — the answer was in the file (ogazboiz, 2026-09-23:
 * "in the member side they have wink in the avatar side and follow too").
 *
 *   · WINK — the white disc with the winking face. Square's one-tap signal of
 *     interest, the same `useWink` every other surface uses, so its refusals
 *     behave identically: a 429 here can mean the hourly budget is spent OR
 *     that this person was already winked today, and the service's own wording
 *     travels with the deadline rather than being flattened into "out of
 *     winks".
 *   · FOLLOW — and the file draws BOTH of its states, which is how it says
 *     this is a toggle: `profile-add` on #7E3BEB when you do not follow them,
 *     `profile-tick` in the accent on white when you do.
 *
 * `useIsFollowing` rather than `profile.isFollowing`: the flag is OPTIONAL and
 * absent is not "no", so the shared hook is the one that knows the difference
 * and a payload without the edge can never render a fabricated "Following".
 *
 * Neither control navigates. The photo and the name do, to the person's
 * profile, so a tap on a face goes where a tap on a face goes everywhere else.
 */
export function HouseMemberTile({ profile }: { profile: Profile }) {
  const wink = useWink(profile);
  const follow = useFollow(profile);
  const isFollowing = useIsFollowing(profile);
  const gate = useGate();
  const me = useMe();
  const name = profile.displayName || profile.username;
  // Winking or following yourself is not a thing. The badges go; the tile stays.
  const isSelf = me.data?.id === profile.id;

  return (
    <li className="flex w-[104px] shrink-0 flex-col gap-2">
      {/* `Group 1000002771` — 125 tall, because the badges hang 12 below the
          photo's 113 and the group grows to contain them. */}
      <div className="relative h-[125px] w-[104px]">
        <Link
          href={sq(profileHref(profile))}
          aria-label={`View ${name}`}
          className="ws-press absolute inset-x-0 top-0 block h-[113px] overflow-hidden rounded-[32px] bg-[#EDEDED]"
        >
          <Avatar
            name={name}
            seed={profile.id}
            src={profile.avatarUrl}
            size={113}
            sizeClassName="size-full"
            className="rounded-none border-0"
          />
        </Link>

        {!isSelf && (
          /* `Frame 2147225666` — 56 x 24 centred, 8 between. It is painted
             AFTER the photo so it sits above it without a z-index fight. */
          <div className="absolute bottom-0 left-1/2 flex h-6 -translate-x-1/2 items-center gap-2">
            <button
              type="button"
              disabled={wink.isPending || wink.unavailable || wink.winked}
              title={wink.refusal ?? (wink.winked ? `You winked ${name}` : `Wink at ${name}`)}
              aria-label={`Wink at ${name}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                gate(() => wink.send());
              }}
              className={cn(
                /*
                  `Button` — a 24 disc at WHITE 20%, with a WHITE face.

                  It was a solid white disc with the face in the accent, which
                  is the follow badge's colouring, not this one's. The file
                  gives the two badges different treatments on purpose: the
                  wink sits ON the photo and is meant to read as glass, while
                  the follow badge is a solid control beside it.

                  No shadow: `effects` is EMPTY on both badge frames. The
                  drop shadow here was invented.
                */
                "grid size-6 place-items-center rounded-full bg-white/20 transition-opacity",
                wink.winked || wink.unavailable || wink.isPending
                  ? "cursor-not-allowed opacity-60"
                  : "ws-press hover:opacity-90"
              )}
            >
              <GlyphFromFigma name="wink-face" size={16} />
            </button>

            <button
              type="button"
              disabled={follow.isPending}
              aria-label={isFollowing ? `Unfollow ${name}` : `Follow ${name}`}
              aria-pressed={isFollowing}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                gate(() => follow.mutate(!isFollowing));
              }}
              className={cn(
                "ws-press grid size-6 place-items-center rounded-full transition-opacity hover:opacity-90 disabled:opacity-60",
                // The file draws both states: filled accent to ask, white with
                // the accent tick once it is done.
                isFollowing ? "bg-white text-[#7E3BEB]" : "bg-[#7E3BEB] text-white"
              )}
            >
              <GlyphFromFigma name={isFollowing ? "profile-tick" : "profile-add"} size={14} />
            </button>
          </div>
        )}
      </div>

      <Link
        href={sq(profileHref(profile))}
        className="ws-press truncate text-center text-[14px] leading-6 text-white"
      >
        {name}
      </Link>
    </li>
  );
}

/*
  THE EXACT EXPORTED NODES, not look-alikes.

  These three glyphs were hand-drawn inline SVGs — a circle, two dots and an
  arc standing in for `Component 14`, and two guesses at vuesax's
  `profile-add` / `profile-tick`. Close enough to pass a glance and wrong in
  every curve. They are now the file's own exports, and each carries the
  colour the design gives it: `profile-tick` in #7E3BEB for the followed
  state, `profile-add` and the wink face in white.

  Rendered at the node's own size inside the 24 disc rather than stretched to
  fill it: 16 for the face, 14 for the follow glyphs, which is what the file
  draws.
*/
function GlyphFromFigma({
  name,
  size,
}: {
  name: "wink-face" | "profile-tick" | "profile-add";
  size: 14 | 16;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={asset(`/icons/house-members/${name}.svg`)}
      alt=""
      aria-hidden
      width={size}
      height={size}
      style={{ width: size, height: size }}
    />
  );
}
