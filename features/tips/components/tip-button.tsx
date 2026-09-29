"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { useGate } from "@/hooks/use-gate";
import { useMe } from "@/hooks/use-me";
import { IconDonate } from "@/components/ui/room-icons";
import { IconMsGift } from "@/components/ui/design-icons";
import { GiftSheet } from "@/components/ui/gift-sheet";
import type { LiveGift } from "@/lib/gifts";
import { multiplyKash } from "@/lib/kash-amount";
import { toast } from "sonner";
import { useSendTip } from "@/features/tips/hooks/use-tips";
import { useTippingUnavailable } from "@/features/tips/lib/availability";
import { useTipCapability } from "@/features/tips/hooks/use-tips";
import { tipBlockedBecause, tipSurfaceOf } from "@/lib/tip-capability";
import type { TipTarget } from "@/features/tips/lib/types";

/**
 * "Give a tip" — the icon-only pill that opens the tip flow.
 *
 * Renders NOTHING in two cases, both of them "this control could not do
 * anything if you pressed it":
 *
 *  1. **It is your own post.** Self-tipping is a 400 by contract, so a button
 *     that can only ever fail is worse than no button. Same rule, same reason
 *     as `FollowPill` and `PersonRow`'s own-row guard — and, as there, it is
 *     COMPARED rather than assumed impossible.
 *  2. **The service answered 404.** Tipping is not deployed yet; a 404 means
 *     "not there", not "your tip failed", so the control goes quiet exactly as
 *     `useBookmarkPost().unavailable` does — see `lib/availability.ts` for why
 *     that answer is shared across every card rather than per-button.
 *
 * Quiet, note, not disabled. The flag-off convention (`MARKET_FLAGS`) is
 * "visible and inert" because a flag records a roadmap decision worth showing.
 * This is not a flag: it is a route that is missing today and will simply be
 * there tomorrow, with nothing for a user to read or do about it in between.
 */
export function TipButton({
  target,
  balanceCoins,
  onTopUp,
  variant = "icon",
}: {
  target: TipTarget;
  /**
   * THE READER'S COIN BALANCE, and a number rather than a slot.
   *
   * The sheet this opens is the ROOM'S — coins, quantities, a top-up link —
   * so what it needs is a coin count, not a rendered KASH line. The old
   * `balance` slot existed because `TipSheet` displayed a KASH figure and the
   * kash slice owns that; this needs no rendering from anybody.
   *
   * Still composed in at the layout level (`home-screen`, `feed-screen`),
   * because the coin balance belongs to the gifts slice and slices never
   * import each other.
   */
  balanceCoins?: number | null;
  /** Short of coins — opens the top-up the layout owns, for the same reason. */
  onTopUp?: (needed: number) => void;
  /**
   * "icon" is the timeline's 42×26 glyph pill described above.
   *
   * "post" is the timeline card's own, node 496:13390 — 38×34 around a 24px
   * GIFT, in the same fill and rim as "icon". The current file draws tipping
   * on a post as a gift rather than as a coin into a palm, and larger, so it
   * balances the 40.7 wink and the 38 Following pill beside it. "icon" keeps
   * the older 42×26 for the surfaces measured against that node.
   *
   * "dock" is the LABELLED pill node 121:10996 draws in a gist room's bottom
   * bar — the same purple ramp as `Record Gist` beside it, 40 tall, with the
   * `la:donate` glyph and the words "Give a tip". A bar with one labelled
   * control and one bare glyph reads as a mistake, and the file labels this
   * one. Every guard above still applies: on your own room, on a 404, or where
   * the capability refuses the recipient, it still renders nothing.
   */
  variant?: "icon" | "post" | "dock";
}) {
  /*
    ONE GIFT, PRICED THE WAY THE ROOM PRICES IT.

    The room multiplies the gift's own KASH price by the quantity and refuses
    anything that cannot be priced EXACTLY — three Roses is 0.03, never
    0.030000000000000002 — because rounding would bill an amount the sender was
    never shown. A post is the same money on the same rail, so it is the same
    arithmetic rather than a second one written here.

    No `toProfileId`: a post has exactly one recipient by construction, which
    is what the sheet's absent `recipients` already says.
  */
  const send = useSendTip();
  const sendGift = (gift: LiveGift, quantity: number) => {
    const amountKash = multiplyKash(gift.priceKash, quantity);
    if (!amountKash) {
      toast.error("That quantity can't be priced exactly.");
      return;
    }
    send.mutate({ target, amountKash, giftId: gift.id });
    setOpen(false);
  };

  const [open, setOpen] = useState(false);
  // Counts openings. It does two jobs: zero means the sheet has never been
  // opened and need not be in the tree at all, and the value keys the sheet so
  // each opening REMOUNTS it — which is what resets the amount, the stage and
  // any previous failure, without a reset effect.
  const [opened, setOpened] = useState(0);
  const gate = useGate();
  const me = useMe();
  const unavailable = useTippingUnavailable();
  const capability = useTipCapability();

  const isMine = Boolean(target.recipient && me.data?.id === target.recipient.id);
  if (isMine) return null;

  /**
   * 3. **The service will not accept a tip for this account.**
   *
   * Production publishes `verifiedAuthorsOnly: true`, so an unverified author
   * cannot receive one. The button used to open anyway: the reader picked a
   * gift, confirmed, and was refused at the last step. Same rule as the two
   * cases above — a control that can only fail is worse than no control.
   *
   * WHICH RULE, THOUGH, IS THE TARGET'S TO SAY. Production now publishes two
   * and they DISAGREE: `verifiedAuthorsOnly: true` for a byline,
   * `verifiedRoomRecipientsOnly: false` for a gist room, because somebody who
   * picked a person off a live roster in a room they are both in is not the
   * impersonation the badge exists to stop. Reading the author rule here hid
   * the room's own tip pill from an unverified host the service would have
   * paid — a control missing, with nothing failing anywhere to say so. So the
   * surface is DERIVED from the target rather than defaulted.
   *
   * A capability we could not read leaves the button alone, because the
   * alternative is hiding tipping everywhere over a failed lookup.
   */
  if (tipBlockedBecause(capability.data, target.recipient, tipSurfaceOf(target.kind)) !== null)
    return null;

  // The 404 can also arrive MID-FLOW, from this very sheet. Hiding the button
  // then must not take the open dialog down with it: the person pressed Send
  // and is owed an answer, so the trigger goes and the sheet stays until they
  // close it. Only after that does the control disappear for good.
  if (unavailable && !open) return null;

  if (variant === "dock") {
    return (
      <>
        {!unavailable && (
          <button
            type="button"
            onClick={() =>
              gate(() => {
                setOpened((n) => n + 1);
                setOpen(true);
              })
            }
            /* 32, not 40 — node 369:9468 is 98x32: 12 and 8 of padding around
               a 16 glyph, 8 of gap, and a 50-wide label, which comes to exactly
               98. At 40 the pill stood taller than the 40px circles beside it
               read as, and the bar had two different button heights in it. */
            className="ws-press flex h-8 shrink-0 items-center gap-2 rounded-full bg-[linear-gradient(90deg,var(--color-create)_0%,var(--color-create-deep)_100%)] px-3 text-[12px] font-medium leading-4 text-white shadow-[0_1px_2px_-1px_rgba(0,0,0,0.1),0_1px_3px_0_rgba(0,0,0,0.1)] transition-opacity hover:opacity-90"
          >
            <IconDonate className="h-4 w-4" />
            Give a tip
          </button>
        )}
        {opened > 0 && (
          <GiftSheet
            key={opened}
            open={open}
            onClose={() => setOpen(false)}
            onSend={sendGift}
            priced
            balanceCoins={balanceCoins}
            onTopUp={onTopUp}
          />
        )}
      </>
    );
  }

  return (
    <div className="group relative">
      {!unavailable && (
        <button
          type="button"
          aria-label="Give a tip"
          onClick={() =>
            gate(() => {
              setOpened((n) => n + 1);
              setOpen(true);
            })
          }
          /* The design's geometry: 42×26 with 4px/12px padding around a 16px
           glyph, a full-round rim in --color-spotlight-chip-ink, and the
           ramp's dark stop at 34% behind it. Both colours are TOKENS — the
           measured #7E3BEB and #C27AFF are exactly --color-spotlight and
           --color-spotlight-chip-ink, so no third purple is introduced. */
          className={cn(
            "ws-press flex shrink-0 items-center justify-center rounded-full",
            "border border-spotlight-chip-ink bg-spotlight/35 transition-colors",
            "hover:bg-spotlight/55",
            variant === "post"
              // 496:13390: 38×34, and the glyph is --color-create rather than
              // the rim's lighter ink. The file measures #9F5AFF there, which
              // is --color-create to within a hair (ΔE ≈ 3, on a 24px line
              // glyph); the token is used so no third purple enters the ramp.
              //
              // NO PADDING. The file states 4/12 on this button and then fixes
              // it at 38 wide around a 24 glyph, which leaves 7 — the width
              // wins, and the stated padding is what the frame was before it
              // was resized. Carried over literally it squeezed the glyph to
              // 12×24: 38 less 24 of padding leaves 14, and an SVG that is not
              // shrink-0 gives up the difference in width alone.
              ? "h-[34px] w-[38px] text-create"
              : "h-[26px] w-[42px] px-3 py-1 text-spotlight-chip-ink"
          )}
        >
          {/*
            `la:donate` — the file's OWN tip glyph, exported from node
            121:10998.

            It used to be `IconMsHandDeposit`, a hand-drawn coin-into-palm from
            `design-icons.tsx`. The file does not contain that glyph anywhere;
            the one tip control it draws uses `la:donate`, so both surfaces now
            use it and there is a single tip mark in the product rather than
            two that happen to mean the same thing.
          */}
          {variant === "post" ? (
            <IconMsGift className="h-6 w-6 shrink-0" />
          ) : (
            <IconDonate className="h-4 w-4" />
          )}
        </button>
      )}

      {/* Tooltip, in the app's one existing pattern (the icon rail's, in
          `app-shell`): a positioned span revealed by the group's hover state,
          `pointer-events-none` so it can never eat the click it describes.
          Three departures, all deliberate:
            · it also opens on `group-focus-within`, so a keyboard user sees the
              same label a mouse user does — the rail's version is hover-only;
            · it is `aria-hidden`, because the button already carries the label
              as its accessible name and a screen reader reading "Give a tip"
              twice is noise, not redundancy;
            · it opens BELOW the button (`top-full`), not above it. This control
              sits at the very top of the post card, so an upward tooltip left
              the card entirely and rendered into the sticky column header's
              stacking context — which owns that strip and painted OVER it, so
              the label read as clipped/behind ("it should be over, not under",
              2026-09-28). Downward it stays inside the card's own content, above
              which nothing competes, so `z-50` is enough and it is never cut.
          The purple is the ramp's DARK stop with white ink, which is the rule
          for a solid purple fill (5.66:1); the light stop under white text
          would fail AA. */}
      {!unavailable && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-full left-1/2 z-50 mt-2 hidden -translate-x-1/2",
            "whitespace-nowrap rounded-lg bg-spotlight px-2.5 py-1 text-xs font-semibold text-white shadow-lg",
            // Pointer devices only. On touch there is no hover, and
            // `group-focus-within` fires on TAP — so the tooltip appeared
            // exactly when the sheet did, leaving a stray "Give a tip" over
            // the page. A tooltip explains a control you are pointing at; a
            // finger has already pressed it.
            "md:group-hover:block md:group-focus-within:block"
          )}
        >
          Give a tip
        </span>
      )}

      {/* In the tree only once opened: one sheet per visible post, all mounted
          up front, would put dozens of dialogs in the DOM to show none of
          them. It stays mounted after closing so the sheet's exit animation
          has something to animate — the `key` is what makes the NEXT opening
          a clean one. */}
      {opened > 0 && (
        <GiftSheet
          key={opened}
          open={open}
          onClose={() => setOpen(false)}
          onSend={sendGift}
          priced
          balanceCoins={balanceCoins}
          onTopUp={onTopUp}
        />
      )}
    </div>
  );
}
