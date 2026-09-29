"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { GiftGrid } from "@/components/ui/gift-grid";
import { LIVE_GIFTS, type LiveGift } from "@/lib/gifts";
import { asset } from "@/lib/square-path";
import { Button } from "@/components/ui/button";
import { IconX } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";

/**
 * The live room's gift tray — the designed grid, plus what a room needs.
 *
 * GEOMETRY is the file's, converted once. The frame is drawn at 254px wide
 * against a 375px phone, so every measurement here is the design's × 1.4764:
 * the 15.56px close button is 23, the 10.13px title is 15/20, the 5.19px
 * column gap is 7.7, the 15.56px row gap is 23, and the tiles land at ~93×90.
 * The scale factor is written down because the alternative is fourteen
 * unexplained decimals.
 *
 * ARTWORK is the file's too — fourteen rendered objects, exported and cropped
 * from the source rather than redrawn or swapped for emoji. The tray they
 * replace used 🌹✨🔥, which is a placeholder wearing a product's clothes.
 *
 * TYPE: the file names Roboto; the app is Geist throughout, so this renders at
 * the file's weights and sizes in the house face — the same call the topic
 * picker and person row already make.
 *
 * WHAT THE FILE COULD NOT SAY, and is therefore ours:
 *
 *  · Every tile in the file is priced "20", which is a placeholder, not a
 *    price list. The ladder below is ours and is ordered by what the object
 *    means — a rose is the smallest thing you can say, the KASH coin itself is
 *    the largest.
 *  · The file draws no confirm step. Sending money on a single tap, with no
 *    total and no undo, is not a design decision a picker can make for you —
 *    so selection stays a selection, and the amount is committed by a button
 *    that names it.
 */
const QUANTITIES = [1, 5, 10] as const;

/** Somebody a gift can be sent to — the room's own roster, resolved already. */
export interface GiftRecipient {
  id: string;
  name: string;
  /** Marked in the list, and the default, so a gift with no thought lands right. */
  isHost?: boolean;
}

export function GiftSheet({
  open,
  onClose,
  onSend,
  viewerIsHost = false,
  priced = false,
  recipients,
  initialRecipientId,
  balanceCoins,
  onTopUp,
}: {
  open: boolean;
  onClose: () => void;
  onSend: (gift: LiveGift, quantity: number, recipient: GiftRecipient | null) => void;
  /**
   * WHO CAN BE GIFTED. Absent on a broadcast, where the gift goes to the host
   * and there is nobody else to choose — the picker is then not drawn at all
   * rather than drawn with one disabled row.
   *
   * Present in a gist room, where the whole point is that you can gift ANYBODY
   * on the stage or in the audience (ogazboiz, 2026-09-24). The host is first
   * and is the default, so a sender who ignores the row still pays the person
   * today's route would have paid anyway.
   */
  recipients?: readonly GiftRecipient[];
  /**
   * OPEN ON THIS PERSON, when the tray was reached by tapping THEM rather than
   * by tapping the dock's gift button. Two doors into one tray: pick the
   * object then the person, or pick the person then the object. Absent falls
   * back to the host, which is the first row.
   */
  initialRecipientId?: string | null;
  /**
   * HOW MANY COINS THIS READER HOLDS, when the tray is priced.
   *
   * An honest tray is the whole point of keeping pay-at-send instead of
   * inventory: every tile tells the truth about its price AND about whether
   * this person can send it right now. A grid of fourteen objects, eight of
   * which get refused at the last step, is the "it looks fake" complaint
   * arriving from a different direction.
   *
   * NULL IS "NOT KNOWN", NOT "NOTHING". A balance still loading, or an account
   * read that failed, must not grey the tray out — that would be the interface
   * inventing a shortfall it cannot see, and the service is the only thing
   * that can actually refuse a spend. Unknown leaves everything sendable and
   * lets the service answer.
   */
  balanceCoins?: number | null;
  /**
   * OPEN THE KASH TOP-UP, when the reader cannot afford what they chose.
   *
   * This is the TikTok shape and ogazboiz named it: you do not stop somebody
   * who is trying to spend money, you sell them the means. Blocking a tile
   * tells a willing sender "no"; offering the recharge tells them "here".
   */
  /**
   * Opens the COIN purchase, and is told how many coins this tray wanted.
   *
   * The shortfall travels with it so the buy sheet can offer exactly that
   * amount first. It used to take no argument and open the KASH top-up, which
   * is a different currency: somebody with KASH already in their wallet was
   * sent to buy more KASH and came back with the same zero coins.
   */
  onTopUp?: (needed: number) => void;

  /**
   * Whether sending this actually costs KASH.
   *
   * False today, and the copy follows it exactly. There is no
   * `POST /streams/{id}/tips` — the KASH tip rail exists but is scoped to
   * posts — so a live gift is a free on-stream moment, and the sheet must not
   * print a price, a total, or the word "tip" for something nobody is charged
   * for. Flip it with `MARKET_FLAGS.liveGifts` once the route ships.
   */
  priced?: boolean;
  /**
   * The READER runs this room. The title says who the money is FOR, and for
   * the host that is never "your creator" — they are the creator; their tray
   * tips the audience.
   */
  viewerIsHost?: boolean;
}) {
  const [selectedId, setSelectedId] = useState(LIVE_GIFTS[0].id);
  const [quantity, setQuantity] = useState<number>(1);
  // The host leads the roster, so index 0 is the sane default without this
  // sheet needing to know what a host is.
  /*
    WHO THIS GIFT IS FOR — AND WHY IT IS NOT PLAIN `useState(initialRecipientId)`.

    `useState` captures its argument ONCE, at mount. `house-room` renders this
    sheet UNCONDITIONALLY — only `open` hides it — so the sheet mounts with the
    room and never mounts again. Tapping "Gift" on somebody sets `giftTo` in
    the room, the prop changes, and `toId` kept the value it had at mount:
    null. `recipient` then fell through to `people[0]`.

    So the sheet could send a gift to THE FIRST PERSON IN THE ROSTER instead of
    the person whose Gift button was pressed. Real money to the wrong human,
    and silent — the tray names whoever it resolved, so it looks deliberate.
    That is exactly the failure `toProfileId` and `giftablePersonId` were added
    to prevent, arriving through this component's own state instead.

    The caller's choice is therefore the SOURCE, and an in-sheet pick overrides
    it only until the caller names somebody else. Reset during render rather
    than in an effect — React's documented way to adjust state when a prop
    changes, and it avoids the cascading re-render an effect would cause.
  */
  const [picked, setPicked] = useState<string | null>(null);
  const [lastNamed, setLastNamed] = useState<string | null>(initialRecipientId ?? null);
  if ((initialRecipientId ?? null) !== lastNamed) {
    setLastNamed(initialRecipientId ?? null);
    setPicked(null);
  }
  const toId = picked ?? initialRecipientId ?? null;
  const setToId = setPicked;
  const people = recipients ?? [];
  const recipient = people.find((person) => person.id === toId) ?? people[0] ?? null;
  const selected = LIVE_GIFTS.find((gift) => gift.id === selectedId) ?? LIVE_GIFTS[0];
  // Exact, never `Number(price) * quantity` — three Roses at 0.01 is 0.03, and
  // the float answer is 0.030000000000000002, which the engine rejects for
  // exceeding six places. The button must show the number that will be
  // charged. Null falls back to the single price rather than printing a total
  // this sheet cannot stand behind.
  /*
    THE TOTAL IS COINS, AND COINS ARE INTEGERS.

    That is the quiet benefit of the unit change: a gift total was decimal
    KASH, where three Roses at 0.01 is 0.03 and the float answer is
    0.030000000000000002 — a number the engine rejects and which was never
    what the sender was shown. Coins are whole, so the arithmetic is exact by
    construction and `multiplyKash` is no longer needed here.
  */
  const total = selected.priceCoins * quantity;

  /*
    SHORT OF KASH IS NOT A REFUSAL, IT IS A DETOUR.

    An earlier pass made unaffordable TILES inert. That was wrong, and
    ogazboiz named the right shape: "if they don't have, they can still buy —
    just like TikTok gifting". Blocking a tile tells somebody who is actively
    trying to spend money "no"; offering the top-up tells them "here". The
    tiles therefore stay live and priced, and the ACTION changes instead.

    Measured on the TOTAL rather than the unit price, because that is the
    number actually being spent — a Rose you can afford once and not ten times
    is short by a quantity, and the same detour fixes both.

    Only when the tray is PRICED. On a free tray nothing is spent, so a balance
    cannot be short of anything.
  */
  const overBalance = priced && typeof balanceCoins === "number" && total > balanceCoins;
  const needsTopUp = overBalance && Boolean(onTopUp);

  /*
    COINS ARE THE INVENTORY, so there is nothing per-gift to hold or to count.

    This tray briefly drew a stock count on every tile, back when a gift was
    something you owned. ogazboiz settled the model — "we are doing it the
    tiktok way you understand since no inventory" — and the count had nothing
    left to count: what you hold is COINS, which the balance row already says
    once rather than fourteen times.

    So the only gate is the coin balance, which is correct, and it already has
    its detour to the top-up.
  */

  return (
    <Sheet open={open} onClose={onClose} bare>
      <div className="bg-[#1C1C1E] px-4 pb-4 pt-3.5">
        {/* The file's grab handle: 43×2.5, centred, at 6D6D6D. Decorative —
            the sheet already closes on backdrop, Escape and the button. */}
        <div className="flex justify-center" aria-hidden>
          <span className="h-[2.5px] w-[43px] rounded-full bg-[#6D6D6D]" />
        </div>

        <div className="relative mt-3 flex items-center justify-center">
          <h2 className="text-[15px] font-bold leading-5 text-white">
            {/* The HOST is the creator — "Tip your creator" on their own tray
                read as tipping themselves (ogazboiz, 2026-09-28). For them it
                names the real recipients: the room's audience. */}
            {/*
              "SEND A GIFT", NOT "TIP YOUR CREATOR".

              This sheet now opens on a post and on a profile as well as in a
              room, and in most of those the recipient is a PEER — not anybody's
              creator. ogazboiz, twice: "not everything is tip your creator".

              The HOST variant stays, because it is the one case where the
              relationship is real and is the thing being described: a host
              tipping the room is tipping their audience, and that is worth
              saying.
            */}
            {viewerIsHost ? "Tip your audience" : "Send a gift"}
          </h2>
          {/* 23px circle, 4% white, blurred — the file's, pinned right. */}
          <button
            onClick={onClose}
            aria-label="Close"
            className="ws-press absolute right-0 flex h-[23px] w-[23px] items-center justify-center rounded-full bg-white/[0.04] backdrop-blur-[2px] transition-colors hover:bg-white/10"
          >
            <IconX className="h-[9px] w-[9px] text-white" />
          </button>
        </div>

        {/*
          WHO IT IS FOR — a horizontal row of everyone in the room, above the
          tray, because you choose the person before the object.

          DRAWN WHENEVER THERE IS ANYBODY, including when there is exactly one.

          It was `> 1`, on the argument that a control with a single option is
          a label wearing a control's clothes. That was wrong for this surface
          and ogazboiz found it immediately: "how can we select the person we
          want to gift". The row is not only a chooser, it is the ANSWER to
          who this is going to — and hiding it at one leaves a sender pressing
          Send with no statement on screen of who receives it. On a broadcast
          `recipients` is absent entirely, so nothing is drawn there either
          way; this only ever fires in a room.

          The host is first and is the default. A sender who never looks at
          this row still gifts the person today's route would have paid, which
          is what makes this safe to ship before the route can name anybody.
        */}
        {people.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-grey-600">
              Send to
            </p>
            <div
              role="radiogroup"
              aria-label="Who to send this gift to"
              className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {people.map((person) => {
                const chosen = person.id === recipient?.id;
                return (
                  <button
                    key={person.id}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    onClick={() => setToId(person.id)}
                    className={cn(
                      "ws-press flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors",
                      chosen ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/15"
                    )}
                  >
                    {person.name}
                    {person.isHost && (
                      <span className={cn("text-[10px]", chosen ? "text-black/55" : "text-white/55")}>
                        host
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Scrolls, so the quantity row and Send stay put — see the note in
            the post tip sheet. */}
        <div className="mt-6 max-h-[min(46dvh,360px)] overflow-y-auto overscroll-contain">
          <GiftGrid
            selectedId={selectedId}
            onSelect={(gift) => setSelectedId(gift.id)}
            showPrices={priced}
          />
        </div>

        {/*
          YOUR BALANCE, WHERE TIKTOK PUTS IT.

          The coin balance sits beside the tray there for a reason: you decide
          what to send against what you have, and finding out AFTER choosing is
          the moment that feels like a refusal. Drawn only when the tray is
          priced and the number is actually known — an unknown balance stays
          silent rather than printing a zero, the same rule the balance chip
          and the earnings panel follow.

          "Get more" is the same door the Send button becomes when you are
          short; it is here too so somebody can top up BEFORE they are told
          they cannot afford something.
        */}
        {priced && typeof balanceCoins === "number" && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[13px] text-grey-400">
              {/* eslint-disable-next-line @next/next/no-img-element -- the file's coin */}
              <img src={asset("/gifts/coin.svg")} alt="" aria-hidden className="size-4 shrink-0" />
              <span className="tnum text-white">{balanceCoins.toLocaleString()}</span>
            </span>
            {onTopUp && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onTopUp(total);
                }}
                className="ws-press text-[13px] font-semibold text-spotlight transition-opacity hover:opacity-80"
              >
                Get more
              </button>
            )}
          </div>
        )}

        {/* The commit step the file does not draw — see the note at the top. */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <span className="text-[13px] text-grey-400">Quantity</span>
          <div className="ws-inset flex gap-1 p-1">
            {QUANTITIES.map((value) => (
              <button
                key={value}
                onClick={() => setQuantity(value)}
                aria-pressed={quantity === value}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
                  quantity === value ? "bg-accent text-ink" : "text-grey-400 hover:text-white"
                )}
              >
                ×{value}
              </button>
            ))}
          </div>
        </div>

        {/*
          NOBODY TO GIFT IS A REAL STATE, not an edge case — a host opens a
          room and is alone in it until somebody walks in, which is exactly
          the screen ogazboiz was on. Sending then would fly a gift addressed
          to no one, so the action says what is missing instead. `recipients`
          being ABSENT (a broadcast) is a different thing and still sends, to
          the host, as it always did.
        */}
        <Button
          size="lg"
          className="mt-3 w-full"
          disabled={
            (Boolean(recipients) && people.length === 0) ||
            (overBalance && !onTopUp)
          }
          onClick={() => {
            // Short of COINS sends you to the coin purchase instead of
            // sending the gift — and COINS, not KASH: they are different
            // things, and the top-up that bought KASH left the tray exactly as
            // empty as it found it. The tray closes because the buy sheet is a
            // dialog of its own and two stacked dialogs is where focus dies.
            if (needsTopUp) {
              onClose();
              onTopUp?.(total);
              return;
            }
            onSend(selected, quantity, recipient);
            onClose();
          }}
        >
          {recipients && people.length === 0
            ? "Nobody else is here yet"
            : needsTopUp
              ? `Get coins · ${total.toLocaleString()} needed`
              : overBalance
                ? "Not enough KASH"
            : priced
              ? `Send ${selected.name} · ${total.toLocaleString()}`
              : recipient
                ? `Send ${selected.name} to ${recipient.name}`
                : `Send ${selected.name}`}
        </Button>
        {/*
          WHAT THE FREE STATE IS, said without jargon or apology.

          It read "KASH gifting turns on when live settlement ships", which is
          a sentence written for us. A reader does not know what live
          settlement is, cannot tell whether it is a bug or a plan, and is left
          feeling the gift they just sent was not real (ogazboiz, 2026-09-24:
          "why is it showing free ... this is not real").

          So it names the state instead: nothing is charged, nobody is paid,
          and the thing that DID happen — the whole room saw it — is said in
          the present tense rather than as consolation. A free gift here is a
          reaction everyone can see, which is a real act; what it is not is a
          payment, and that is what the sentence has to be straight about.
        */}
        <p className="mt-2 text-center text-[11px] text-grey-600">
          {priced
            ? "Sent from your coin balance."
            : "Nothing is charged — paid gifting isn't switched on yet. Everyone in the room sees what you send."}
        </p>
      </div>
    </Sheet>
  );
}
