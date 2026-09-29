"use client";

import { useState } from "react";
import { IconLive, IconMic, IconQuote } from "@/components/ui/icons";
import { Avatar } from "@/components/ui/avatar";
import { formatKash, relativeTime } from "@/lib/format";
import { LIVE_GIFTS } from "@/lib/gifts";
import { useGate } from "@/hooks/use-gate";
import { useKashAccount, KashBuySheet } from "@/features/kash";
import { useReceivedTips, type ReceivedTip } from "@/features/tips";
import { OpenHouseSheet } from "@/features/houses";
import { asset } from "@/lib/square-path";

/**
 * THE EARNINGS PANEL — nodes 492:46239 (empty) and 492:46539 (populated).
 *
 * A gold balance card, then either the "No earnings yet" state or a
 * "Recently earned" list. Both states share the card; only what sits under it
 * changes, which is why they are one component and not two.
 *
 * ─── WHAT IS REAL, AND THE ONE THING THAT IS NOT ────────────────────────────
 * The BALANCE is the KASH engine's, through the same `useKashAccount` the
 * cover chip reads — not a second query and not a number assembled here.
 *
 * The LIST is `GET /me/tips/received`, whose own summary in the served spec is
 * "the caller's confirmed tips received (earnings)". This is the route that
 * panel was always going to need, and it already existed.
 *
 * THE ROW NAMES THE SENDER, NOW THAT THE SERVICE CAN SAY WHO IT WAS. The tip
 * used to carry `fromUserId` and nothing else about the person, with no route
 * anywhere to turn an id into a profile — `/profiles/{username}` is keyed on
 * the USERNAME. Asked for and built: `GET /me/tips/received` answers
 * `TipWithContext`, an allOf over Tip adding `fromUser` and `source`, resolved
 * in three batched reads per page rather than one per row.
 *
 * BOTH ARE NULLABLE AND BOTH NULLS ARE REAL STATES, not loading:
 *  · `fromUser` is null when the account that sent it is gone — a tip outlives
 *    the sender, because the money moved. The row then keeps the amount and
 *    the gift and says it in the passive; it never prints a placeholder name.
 *  · `source` is null when the tip was aimed at a PERSON rather than a thing,
 *    and `source.title` is null for a picture-only post (a post's title is its
 *    own opening text) or a room with no topic. No source line rather than an
 *    invented one.
 *
 * NOT YET VERIFIABLE. The fields are committed on the backend and NOT deployed
 * to :8094 — deliberately, so a rebuild does not move under a test in
 * progress. Everything here is optional as well as nullable, so today every
 * tip parses without them and the row renders exactly as it did before. This
 * has been read against the agreed shape, not against a live response.
 */

/**
 * The gift a tip carried, resolved from the catalogue both send paths use.
 *
 * ─── AN UNRESOLVED ID IS A DESIGNED STATE, NOT A GAP ────────────────────────
 * The service validates `giftId` as a SHAPE only — `/^[a-z0-9][a-z0-9-]{0,31}$/`,
 * with no allowlist, no catalogue and no price — because the namespace is the
 * CLIENT's. That is deliberate twice over: our catalogue can grow without a
 * backend deploy, and a server-side allowlist would reject a gift the sender
 * was legitimately shown by a build newer than the service's. It is unpriced
 * for a sharper reason still — the moment an id could select a price, a client
 * posting `lion` would be charged whatever the server thinks a lion costs
 * rather than the amount the sender actually agreed to.
 *
 * So there is no list to reconcile against and asking for one would be asking
 * the service to own a namespace that is ours. An id we do not carry is
 * PERMANENTLY reachable — an older client, a newer client, a hand-rolled POST
 * — and the row below treats it as a terminal state to be rendered well, not
 * a defect to be eliminated.
 */
function giftOf(giftId: string | null) {
  return giftId ? (LIVE_GIFTS.find((gift) => gift.id === giftId) ?? null) : null;
}

/**
 * WHICH GLYPH THE SOURCE LINE CARRIES — the service's `kind`, not a guess.
 *
 * A gist room is a stream with category 'house', and the backend resolves that
 * server-side precisely so the client does not infer it. A room is audio, so
 * it keeps the design's mic; a broadcast gets the live mark; a post gets the
 * quote, because a post's "title" IS its opening text.
 */
const SOURCE_ICON = { room: IconMic, stream: IconLive, post: IconQuote } as const;

/** 435:27558 — 741x62 at a 15 radius, 3% white behind a 10% hairline. */
function EarnedRow({ tip }: { tip: ReceivedTip }) {
  const { amountKash, creditedKash, giftId, createdAt, fromUser, source } = tip;
  /*
    THE EARNINGS SCREEN PRINTS WHAT WAS CREDITED, NOT WHAT WAS SENT.

    This is the one screen a person checks before believing they earned
    something, so the number on it has to be the number in their balance.
    `amountKash` is the gift's FACE VALUE — a 1000-coin lion is 1 KASH — while
    a gift's receiver is credited half of it. Printing the face value would
    overstate every gift receipt by double, on the day of a deploy that touched
    nothing in this file.

    ON A TIP THE TWO ARE EQUAL, so there is no branch on kind here: the service
    writes the same amount to both ledger legs and no split exists. The
    fallback is therefore CORRECT and not merely defensive — `creditedKash`
    lands with the gift spend leg, and until it does these are one number.
  */
  const earnedKash = creditedKash ?? amountKash;
  const gift = giftOf(giftId);
  /*
    THREE STATES, NOT TWO. A tip with no `giftId` is a plain typed amount; a
    tip whose id we do not carry is still A GIFT, and saying "you received a
    tip" about it loses the one thing we do know. They shared a branch and
    read identically, which made the second look like the first having failed.
  */
  const unknownGift = Boolean(giftId) && !gift;
  const sender = fromUser?.displayName || fromUser?.username || null;
  const SourceIcon = source ? SOURCE_ICON[source.kind] : null;
  return (
    <li className="relative flex items-center gap-4 rounded-[15px] border border-white/10 bg-white/[0.03] px-4 py-[11px]">
      {/*
        THE SENDER'S FACE WHEN THERE IS ONE, THE GIFT WHEN THERE IS NOT.

        The file draws the sender's photograph here. `fromUser` is nullable by
        design — a tip outlives the account that sent it, because the money
        moved — so the fallback is not a loading state, it is a permanent and
        correct one. It stays exactly what shipped before the field existed:
        the gift that arrived, which is the thing we always know.
      */}
      {fromUser ? (
        <Avatar
          name={sender ?? "Someone"}
          seed={fromUser.id}
          src={fromUser.avatarUrl}
          size={34}
          className="shrink-0 rounded-[25%] border border-white/20"
        />
      ) : (
        <span className="grid h-[34px] w-[34px] shrink-0 place-items-center overflow-hidden rounded-[25%] border border-white/20 bg-white/10">
          {gift ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={gift.art} alt="" aria-hidden className="h-full w-full object-contain p-1" />
          ) : (
            /* A gift whose art we do not have still moved money, so the disc
               carries the coin rather than sitting empty — deliberate, not a
               picture that failed to load. A plain tip gets it too: the coin
               is true of both. */
            // eslint-disable-next-line @next/next/no-img-element
            <img src={asset("/gifts/coin-stack.svg")} alt="" aria-hidden className="h-4 w-4" />
          )}
        </span>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* The file's sentence names the sender; ours does only when the
            service hydrated one. Never "Someone gifted you" — an unnamed
            sender is said in the passive rather than given a placeholder. */}
        <p className="truncate text-[12px] font-bold leading-4 text-white">
          {sender
            ? gift
              ? `${sender} gifted you a ${gift.name}`
              : unknownGift
                ? `${sender} sent you a gift`
                : `${sender} tipped you`
            : gift
              ? `You were gifted a ${gift.name}`
              : unknownGift
                ? "You were sent a gift"
                : "You received a tip"}
        </p>
        {/* The amount and the file's own coin. The 18px node between this and
            the source line is an EMPTY text node — a spacer, drawn as
            nothing, which is why there is no separator character here. */}
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex shrink-0 items-center gap-1">
            <span className="tnum text-[12px] leading-5 text-white/50">
              {formatKash(earnedKash)}
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset("/gifts/coin-stack.svg")} alt="" aria-hidden className="h-3 w-3 shrink-0" />
          </span>

          {/* 435:27602 — the source, and ONLY when the service gave us one.
              A null title is three real states (a picture-only post, a room
              with no topic, a tip aimed at a person rather than a thing), so
              the line is absent rather than invented. Already truncated to
              140 upstream, so `truncate` here is for the column, not the
              text. */}
          {SourceIcon && source?.title && (
            <span className="flex min-w-0 items-center gap-2">
              <SourceIcon className="h-3 w-3 shrink-0 text-white" />
              <span className="truncate text-[12px] leading-5 text-white/50">{source.title}</span>
            </span>
          )}
        </span>
      </div>

      {/* 435:27559 — top right, 16 and 16 in, not vertically centred. */}
      {createdAt && (
        <time
          dateTime={createdAt}
          className="absolute right-4 top-4 text-[10px] leading-[15px] text-white/50"
        >
          {relativeTime(createdAt)}
        </time>
      )}
    </li>
  );
}

export function ProfileEarnings() {
  const account = useKashAccount();
  const tips = useReceivedTips(true);
  const gate = useGate();
  const [buyOpen, setBuyOpen] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);

  // Only confirmed tips are earnings. The service's own words on `pending` are
  // that it "must never be presented to a user as though the money arrived",
  // and a failed tip moved nothing at all.
  const earned = (tips.data ?? [])
    .filter((tip) => tip.status === "confirmed")
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  /*
    THE STATUS ENDPOINT DOES NOT GET A VOTE ON THIS NUMBER.

    This read `!account.wallet || status.isError || account.isError`, so a
    failing `GET /kash/status` blanked a balance the account query had already
    answered with. Those are different questions: status carries the ENGINE'S
    PARAMETERS — the token address, the price, whether the desk is open — which
    matter for BUYING and say nothing about whether a balance we hold is real.
    `KashBalance` has always read the account alone; this now matches it.

    Still absent rather than zero when the account itself cannot answer: "0
    KASH+" on a balance that failed to load is a claim about somebody's money
    the client cannot make, and an em-dash is the null the rest of the app
    already uses for a count it does not have.
  */
  const balance = account.data?.balance ?? null;
  const engineDown = !account.wallet || account.isError;

  return (
    /*
      The file's 32 gutter is a 741-wide column's gutter. On a 390 phone it
      spends 64 of the screen before the card starts, which is most of what the
      balance was short of. 16 below `sm` — the platform's own touch gutter —
      and the file's 32 from there.
    */
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
      {/*
        432:25745 — 741x112 at a 20 radius on the gold ramp.

        THE FILE'S ROW IS A DESKTOP ROW, AND 741 IS WHY IT FITS.

        Built as one flex line it held an 80 image, a 131 button and 48 of
        padding — about 275 before a word is drawn. On a 390 phone that leaves
        roughly 99px for the text, so "Available balance" wrapped onto two
        lines and the 32px figure beside it truncated to "0..". A balance is
        the one number on this card and it was the thing that got cut.

        So the row STACKS below `sm`: the art and the figure keep their line,
        and the button takes its own full-width one beneath. From `sm` it is
        the file's single row again, unchanged — the art and text are nested
        in their own flex with the same gap, so the three-part spacing the
        node draws is preserved rather than re-derived.
      */}
      <div className="ws-kash-card flex flex-col gap-4 rounded-[20px] px-5 py-4 sm:flex-row sm:items-center sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset("/gifts/kash-balance-art.png")}
            alt=""
            aria-hidden
            // 64 on a phone, the file's 80 from `sm`: the art is decoration
            // and the balance is not, so the art gives up the width.
            className="h-16 w-16 shrink-0 object-contain sm:h-20 sm:w-20"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-[16px] font-medium leading-6 text-white">Available balance</p>
          {/*
            `#6C2B09` — dark type on the gold, which is the only place in the
            app that inverts. The file sets Clash Display here; this repo does
            not load it and `ws-display` is the bold display face it does have,
            so the weight and the tracking carry rather than the face.

            ABSENT RATHER THAN ZERO, the same rule as the cover chip: "0 KASH+"
            on a balance that has simply not loaded is a claim about somebody's
            money that the client cannot make.
          */}
            <p className="ws-display truncate text-[32px] leading-[37.5px] !text-[#6C2B09]">
              {engineDown || balance === null ? "—" : formatKash(balance)}
            </p>
          </div>
        </div>

        {/*
          1285:76793 — 131x34, `#F5F5F5` inside a THREE pixel 20%-white ring,
          at a 30 radius, 16/10 of padding on an 8 gap.

          TWO THINGS THE EARLIER BUILD MISSED, both read from the node rather
          than the summary:

          · THE WALLET GLYPH. `empty-wallet-add` at 16, the file's own export —
            and it is painted `#6C2B09`, the brown of the balance figure, NOT
            the `#0A0A0A` of the label beside it. That two-tone is deliberate
            in the file: the glyph belongs to the number it will change, the
            word belongs to the button. Baked into the asset rather than
            inherited, because an `<img>` cannot take `currentColor`.

          · THE SHADOW. `0 2 10` at `#785000` 25% — a warm shadow, not a black
            one, which is what keeps a white pill from looking pasted onto the
            gold rather than resting on it. A neutral drop shadow here reads as
            grey dirt against the ramp.
        */}
        <button
          type="button"
          onClick={() => setBuyOpen(true)}
          // Full width on its own line below `sm` — a 131px pill squeezed
          // beside the figure is what pushed the balance out in the first
          // place. From `sm` it is the node's own 131x34 pill again.
          className="ws-press flex h-[34px] w-full shrink-0 items-center justify-center gap-2 rounded-[30px] border-[3px] border-white/20 bg-[#F5F5F5] px-4 text-[13px] font-semibold leading-5 text-[#0A0A0A] shadow-[0_2px_10px_rgba(120,80,0,0.25)] transition-opacity hover:opacity-90 sm:w-auto sm:justify-start"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- the node's own export */}
          <img src={asset("/gifts/wallet-add.svg")} alt="" aria-hidden className="h-4 w-4 shrink-0" />
          Buy KASH+
        </button>
      </div>

      {earned.length === 0 ? (
        /* 435:26118 — 486 wide, centred, 24 between each block. */
        <div className="mx-auto flex max-w-[486px] flex-col items-center gap-6 py-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset("/gifts/earnings-empty.svg")} alt="" aria-hidden className="h-[120px] w-[120px]" />
          <div className="flex flex-col gap-2">
            <h3 className="text-[20px] font-bold leading-[23.4px] text-white">No earnings yet</h3>
            {/* The file breaks this line itself, after "keep track". Kept as a
                soft wrap rather than a hard one: at our column width a forced
                break would land in the wrong place. */}
            <p className="text-[16px] leading-6 text-white/50">
              Once you start getting gifts from your loved ones, you can keep track of your history
              here
            </p>
          </div>
          {/*
            492:46825 — 213x48 on `--color-spotlight`, and the file draws FOUR
            children of which TWO are `visible: false`: the leading User avatar
            and the trailing ArrowRight. Only the mic and the label render, so
            only those are built.

            The CTA is a gist room because that is where gifts come from — the
            empty state points at the thing that would fill it, which is the
            one useful thing an empty state can do.
          */}
          {/*
            OPENS THE CREATE SHEET IN PLACE — it does NOT navigate. Linking to
            `/gist-rooms?open=1` opened the same sheet but only after a page
            change, which read as "it took me to another page" instead of a
            modal (ogazboiz, 2026-09-28). So the earnings panel mounts the very
            sheet the rooms page mounts (`OpenHouseSheet`) and opens it right
            here, gated the same way — `useGate` sends a signed-out reader to
            sign in first, exactly as houses-street does.
          */}
          <button
            type="button"
            onClick={() => gate(() => setRoomOpen(true))}
            className="ws-press flex h-12 items-center gap-2.5 rounded-full bg-spotlight px-5 text-[16px] font-bold leading-[22px] text-white transition-opacity hover:opacity-90"
          >
            <IconMic className="h-6 w-6 shrink-0" />
            Start Gistroom
          </button>
        </div>
      ) : (
        <section className="flex flex-col gap-4">
          <h3 className="text-[16px] leading-6 text-white/50">Recently earned</h3>
          <ul className="flex flex-col gap-4">
            {earned.map((tip) => (
              <EarnedRow key={tip.id} tip={tip} />
            ))}
          </ul>
        </section>
      )}

      <KashBuySheet open={buyOpen} onClose={() => setBuyOpen(false)} />
      <OpenHouseSheet open={roomOpen} onClose={() => setRoomOpen(false)} />
    </div>
  );
}
