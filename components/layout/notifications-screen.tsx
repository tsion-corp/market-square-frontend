"use client";

import { NotificationsPage } from "@/features/notifications";
import { PushPrompt } from "@/components/layout/push-prompt";
import type { MarketNotification } from "@/features/notifications/lib/types";
import { useFollow, useWink } from "@/features/profile";
import { useIsFollowing } from "@/features/profile";
import { useGate } from "@/hooks/use-gate";
import { useMe } from "@/hooks/use-me";
import type { Profile } from "@/lib/api/schemas";
import { asset } from "@/lib/square-path";

/**
 * Joins the notifications and profile slices, which never import each other.
 *
 * A notification row's action is a PROFILE act — winking back, following back —
 * so the buttons live here and reach the row through `actionSlot`, the same
 * route-slot pattern `home-screen` and `profile-screen` use.
 */

/** 742:15885 — 90x24 at a full round, 8/4 of padding, label at Geist 600 11/16. */
const PILL =
  "ws-btn-welcome ws-press flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold leading-4 text-white transition-opacity hover:opacity-90 disabled:opacity-50";

/**
 * WINK BACK — 742:15887 is the button's own 14px glyph, exported rather than
 * substituted.
 *
 * `useWink` is not a bare mutation — it answers `{ send, winked, isPending,
 * unavailable, refusal }`, and all four of the read fields matter here. The
 * service rate-limits winks and answers 429 with ITS OWN wording, which
 * `refusal` carries: a 429 can mean "your hourly budget is spent" or "you
 * already winked this person today", and only the service knows which, so the
 * button shows the service's sentence rather than a guess. `winked` flips the
 * label instead of leaving a control that would send a second one.
 *
 * Disabled rather than hidden, so the row does not reflow under the reader.
 */
function WinkBack({ profile }: { profile: Profile }) {
  const wink = useWink(profile);
  const gate = useGate();
  const me = useMe();
  if (me.data?.id === profile.id) return null;
  return (
    <button
      type="button"
      disabled={wink.isPending || wink.unavailable || wink.winked}
      title={wink.refusal ?? undefined}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        gate(() => wink.send());
      }}
      className={PILL}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset("/notifications/notif-btn-wink.svg")} alt="" aria-hidden className="h-3.5 w-3.5" />
      {wink.winked ? "Winked" : "Wink back"}
    </button>
  );
}

/**
 * FOLLOW BACK — 742:15909's glyph, same 90x24 pill.
 *
 * Absent once the edge exists in either direction: a button that says "Follow
 * back" to somebody you already follow is telling the reader something untrue
 * about their own account. `useIsFollowing` is the resolver every follow
 * control must read — a missing `isFollowing` can never render a fabricated
 * "Following".
 */
function FollowBack({ profile }: { profile: Profile }) {
  const follow = useFollow(profile);
  const gate = useGate();
  const me = useMe();
  const isFollowing = useIsFollowing(profile);
  if (me.data?.id === profile.id || isFollowing) return null;
  return (
    <button
      type="button"
      disabled={follow.isPending}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        gate(() => follow.mutate(true));
      }}
      className={PILL}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset("/notifications/notif-btn-follow.svg")} alt="" aria-hidden className="h-3.5 w-3.5" />
      Follow back
    </button>
  );
}

/**
 * ONLY THE TWO KINDS THE FILE DRAWS A BUTTON ON.
 *
 * 742:15855 (wink) and 742:15862 (follow) carry one; the trending, mention and
 * post rows carry only a timestamp. A like or a repost has no reciprocal act,
 * so inventing one for them would be adding a control the design deliberately
 * does not have.
 *
 * An actor is required: a notification from a deleted account has nobody to
 * wink or follow back, and the row still renders without the button.
 */
function rowAction(item: MarketNotification) {
  if (!item.actor) return null;
  if (item.kind === "wink") return <WinkBack profile={item.actor} />;
  if (item.kind === "follow") return <FollowBack profile={item.actor} />;
  return null;
}

export function NotificationsScreen() {
  return <NotificationsPage actionSlot={rowAction} promptSlot={<PushPrompt />} />;
}
