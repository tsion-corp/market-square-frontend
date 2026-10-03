"use client";

import { useState } from "react";
import Link from "next/link";
import { useMe } from "@/hooks/use-me";
import { Avatar } from "@/components/ui/avatar";
import { TOPIC_ICONS } from "@/components/ui/topic-tags-field";
import { IconSpark } from "@/components/ui/icons";
import { useTopics } from "@/features/discovery";
import { housePath } from "@/features/houses";
import { clockLabel, shortDateLabel, startsInLabel } from "@/lib/format";
import type { Stream } from "@/features/streams";
import { asset, api } from "@/lib/square-path";
import { ShareSheet } from "@/components/ui/share-sheet";
import { roomShare } from "@/lib/room-card";

/**
 * HOME'S "COMING SOON" CARD — node 2077:19030 (SQUARE 2.0 Copy), 342 × 106.
 *
 * The redesign of the 467 × 136 card this file used to draw (1542:3294). The
 * shape changed rather than the content: the cover is no longer a rounded tile
 * in a row of four blocks, it is a FULL-BLEED image on the card's left that
 * dissolves under a scrim, so the picture bleeds out beneath the text instead
 * of sitting beside it. The divider is gone; the right column keeps date,
 * time, the "Starts in" pill and Share.
 *
 * Every length here is the node's own. The ones that look like typos are real:
 * the 0.552 stroke, the 7.726 background blur and the 8.83 / 4.415 button
 * padding are a component that was scaled by 0.5519 when it was pasted in, and
 * they divide back to a clean 1, 14 and 16 / 8. They are reproduced as drawn.
 *
 * ─── THE TWO PLACES THIS DELIBERATELY LEAVES THE FILE ────────────────────────
 * 1. "Starts in …" is FIVE pixels in the node — the same 0.5519 scaling, on a
 *    label rather than a box. Five-pixel text is not small, it is unreadable,
 *    and this card has already been rebuilt once for exactly that reason (the
 *    container-query build that shrank everything to ~5px). It is set at 8 to
 *    match the meta text beside it, which is the size its siblings use.
 * 2. THE TITLE AND THE HOST LINE ARE BIGGER THAN THE NODE, at ogazboiz's word
 *    (2026-09-23). The file sets the title and the host's NAME at 10 and the
 *    "Hosted by" label at 8, and at a real 342 that reads as small type on a
 *    card whose whole job is to make somebody want the room. They are scaled
 *    by 1.4 — title and name to 14, label to 11 — which keeps the file's own
 *    relationship between the three (title and name equal, label smaller) and
 *    still clears the card's 106: 32 of title, 8, the 16 chip, 12, the 16 host
 *    row and the 16 it starts down at comes to 100.
 * 3. `Hosted by` / the host's name are ONE text node whose per-character
 *    overrides flip the name to Geist 600 at 10px while the label stays 500 at
 *    8px (`styleOverrideTable` 5 → 7). The parent style says 500/8 for the
 *    whole string and is wrong; both runs are drawn as the overrides specify.
 *
 * The cover, topic glyph, calendar and share icons are the file's own exports,
 * already on disk from the previous build — each vector compared against a
 * fresh export of the new node before being reused, not assumed from the name.
 */

/** The topic the file draws with its own exported glyph. */
const FIGMA_TOPIC = "trading";

/** 2077:19030 — the card's own width and height, which the rail sizes to. */
export const COMING_SOON_CARD_WIDTH = 342;

export function ComingSoonCard({ stream }: { stream: Stream }) {
  const topics = useTopics();
  const [sharing, setSharing] = useState(false);
  /*
    IS THIS THE READER'S OWN ROOM? The card is addressed to somebody waiting for
    it to start, and for the HOST that is the wrong audience — they are the
    person being waited on, and the only one who can do anything about it.
  */
  const me = useMe();
  const mine = Boolean(me.data && stream.ownerId === me.data.id);

  const href = housePath(stream.id);
  const startsAt = stream.scheduledAt;
  const host = stream.owner;
  const topicKey = stream.topics?.[0];
  const topicLabel = topicKey
    ? (topics.data?.find((entry) => entry.key === topicKey)?.label ?? topicKey)
    : null;
  const TopicIcon =
    topicKey && topicKey !== FIGMA_TOPIC
      ? (TOPIC_ICONS[topicKey] ?? IconSpark)
      : null;


  /*
    THE SHEET, NOT THE DEVICE'S OWN — ogazboiz, 2026-09-24: "put that old one
    that it will show share to this share to that instead of the native one".

    Tapping Share went straight to `navigator.share`, which on a desktop is
    nothing recognisable and on a phone is the OS chooser rather than Square's.
    The sheet is the app's own list — WhatsApp, X, Facebook, Telegram, Post to
    Square, Copy link — and the CARD now sits at the top of it as its own two
    rows, because the named destinations are reached by a web intent and an
    intent cannot carry a file.

    The card is built from what THIS screen already knows; see `lib/room-card`
    for why the route takes params rather than reading the room itself.
    `window.location.origin` because the QR has to be scannable from another
    device, where a relative path means nothing.
  */
  const share = roomShare(
    stream,
    href,
    typeof window === "undefined" ? null : window.location.origin,
    api
  );
  return (
    /*
      THE RING IS DRAWN AT THE END OF THIS CARD, NOT HERE — see the last child.

      The inset shadow stays on the root because it is the correct description
      of the node's 0.552 INSIDE stroke, and because it is what shows through
      the few pixels no layer covers. It is not what the reader sees, though:
      an INSET box-shadow paints immediately after the element's own background
      and BEFORE any child content, and this card has two full-bleed absolute
      children — the cover on the left and the scrim at `inset-0` that reaches
      solid #101012 by 120. Between them they cover all four edges, so the
      hairline was painted and then buried on every card.

      It is why the live card and the house card keep their rings and this one
      lost its: they have no child that reaches their edges.
    */
    <div className="relative h-[106px] w-full overflow-hidden rounded-[16px] bg-[rgba(16,16,18,0.62)] shadow-[inset_0_0_0_0.552px_rgba(255,255,255,0.18)] backdrop-blur-[7.726px]">
      {/*
        THE WHOLE CARD OPENS THE ROOM, not just the title.

        The only tap target used to be the title text — a two-line string in the
        middle of a 106px card — so the card read as inert everywhere else and
        a reader who tapped the cover, the host's name or the empty space got
        nothing. ogazboiz reported exactly that: "why cant i not click on the
        card".

        A SPREAD LINK rather than wrapping the card, because the card already
        contains a Share BUTTON and a title link, and an anchor inside an anchor
        is invalid markup that browsers resolve by dropping one of them. This
        sits UNDER the interactive children (they are later in the DOM and
        positioned) and over everything else, so a tap on the cover opens the
        room and a tap on Share still shares.

        `aria-hidden` and not focusable: the title link above is the accessible
        name for this destination and a second tab stop to the same place is
        noise to anybody using a keyboard.
      */}
      <Link
        href={href}
        aria-hidden
        tabIndex={-1}
        className="absolute inset-0 z-0"
      />
      {/* `image 64` — 144.507 wide, full bleed to the card's left edge and
          under everything else. STRETCH in the file; `object-cover` here, so a
          real photograph of any ratio fills the box without distorting. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-[144.507px] overflow-hidden"
      >
        {stream.thumbnailUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- media hosts are unknown at build time */
          <img
            src={stream.thumbnailUrl}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center bg-[#101012]">
            {/* eslint-disable-next-line @next/next/no-img-element -- the node's own export */}
            <img
              src={asset("/gist-rooms/card-default-cover.svg")}
              alt=""
              aria-hidden
              className="h-8 w-11"
            />
          </span>
        )}
      </span>

      {/* `Rectangle 34624595` — the 7px accent, hard on the left edge and drawn
          OVER the image (it is the later sibling in the file). */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-[7px] bg-[#7E3BEB]"
      />

      {/*
        `Frame 1000011513` — THE SCRIM, AND THE ONE PLACE THIS READS THE RENDER
        RATHER THAN THE NODE.

        In the file this is a 302-wide panel from 40px in, filled with a
        gradient that runs UPWARD over the top 17.2% and is flat #101012
        everywhere below. Built that way it is a hard vertical wall at x=40,
        and the picture stops dead against it.

        The file does not LOOK like that, and the reason is the sample: its
        cover is a dark photograph of a trading screen, so it dissolves into
        #101012 on its own and the panel never has an edge to show. A real
        cover is somebody's face in daylight, and then the wall is all you see
        — which is exactly what it did (ogazboiz, 2026-09-23: "the image is not
        fading or blending away").

        So the scrim runs ACROSS instead, and reaches full opacity at 120 —
        BEFORE the image's own 144.5 edge — so that edge is never visible
        whatever the photograph is. It starts clear at the accent bar, is half
        way by 72, and is solid under the text, which is also what keeps a
        title legible over a bright cover.

        The node's vertical variation is NOT reproduced: it lifts the top 18px
        to 25% alpha, and sampling the file's own render shows that reads as
        flat #101012 wherever no picture sits behind it. Carrying it over would
        only punch a translucent band across the top of the text.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to right, rgba(16,16,18,0) 0px, rgba(16,16,18,0.18) 28px, rgba(16,16,18,0.72) 72px, #101012 120px)",
        }}
      />

      {/*
        THE TWO COLUMNS ARE A FLEX ROW, NOT TWO ABSOLUTE BOXES.

        The node is a fixed 342 and its blocks sit at fixed offsets — 64 in for
        the text, 259 for the schedule. Reproduced literally, that only holds AT
        342: the rail caps a card at 95% of its column so a second one peeks, so
        on a narrow column the card comes in around 277, and two absolutely
        placed columns then OVERLAP — the schedule slides under a long title
        with nothing to stop it. It reads as fine until somebody writes a real
        title.

        So the insets the design fixes are kept (64 left, 16 right, the 35
        between) and the TEXT column is the one that gives, exactly as the
        467-wide build before this did. At 342 the text column lands at 153
        rather than the node's 160, because the countdown pill beside it is
        drawn at 8px rather than the file's unreadable 5 and needs the width.
      */}
      {/* `z-10` puts the text column, its title link and the Share button ABOVE
          the card-wide link below, so each keeps its own target. The decorative
          layers between them are `pointer-events-none`, so a tap on the cover
          falls through to the card link rather than landing on an image. */}
      {/*
        POINTER-EVENTS-NONE ON THE COLUMN, AUTO ON WHAT IS ACTUALLY PRESSABLE.

        This div fills the whole card and sits above the card-wide link, so with
        pointer events it swallowed EVERY click and had no handler of its own —
        which is why lifting it to `z-10` fixed the paint order and left the card
        exactly as dead as before. The layers it was lifted over were already
        transparent to clicks; this one was the only thing in the way.

        So the column passes clicks through and the two things that are really
        controls — the title link and Share — take them back.
      */}
      <div className="pointer-events-none relative z-10 flex h-full items-start gap-[35px] pl-[64px] pr-[16px]">
        {/* `Frame 2147230720` — 16 down, 12 gap; the column that flexes. */}
        <div className="mt-[16px] flex min-w-0 flex-1 flex-col gap-[12px]">
          <div className="flex flex-col gap-[8px]">
            <Link
              href={href}
              className="ws-press pointer-events-auto line-clamp-2 text-[14px] font-semibold leading-[16px] text-white"
            >
              {stream.title}
            </Link>
            {topicLabel && (
              /* `Frame 2147225009` — 16 tall, 3/6 padding, 4 gap, white at 10%. */
              <span className="inline-flex h-[16px] w-fit items-center gap-[4px] rounded-full bg-white/10 px-[6px]">
                {TopicIcon ? (
                  <TopicIcon className="h-[10px] w-[13px] shrink-0" />
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element -- the node's own export */
                  <img
                    src={asset("/gist-rooms/card-topic-trading.svg")}
                    alt=""
                    aria-hidden
                    className="h-[10px] w-[13px] shrink-0"
                  />
                )}
                <span className="whitespace-nowrap text-[8px] font-medium leading-[10.4px] text-[#F4F4F4]">
                  {topicLabel}
                </span>
              </span>
            )}
          </div>

          {/* `Frame 2147230648` — host row, 16 tall, 4 gap, centred. */}
          <span className="flex min-w-0 items-center gap-[4px]">
            <span className="size-[16px] shrink-0 overflow-hidden rounded-full border-[0.552px] border-white bg-[#DCDAD5]">
              <Avatar
                name={host?.displayName ?? "Host"}
                seed={stream.ownerId}
                src={host?.avatarUrl}
                size={16}
                sizeClassName="size-full"
              />
            </span>
            <span className="min-w-0 truncate text-white">
              <span className="text-[11px] font-medium leading-[14px]">
                Hosted by{" "}
              </span>
              <span className="text-[14px] font-semibold leading-[14px]">
                {host?.displayName ?? "a host"}
              </span>
            </span>
          </span>
        </div>

        {/* `Frame 2147230722` — 15 down, 8 gap, right-aligned, and it never
            gives: its width is its content. The node's 67 only held while
            "Starts in …" was five pixels; at 8 a real "Starts in 27h 8m" wraps
            inside 67, which is what it did. */}
        <div className="mt-[15px] flex shrink-0 flex-col items-end gap-[8px]">
          <div className="flex flex-col items-end gap-[4px]">
            {startsAt && (
              <div className="flex flex-col items-end gap-[2px]">
                {/* `Frame 2147230647` — calendar + date, 12 icon, 4 gap. */}
                <span className="flex items-center gap-[4px]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- the node's own export */}
                  <img
                    src={asset("/gist-rooms/card-calendar.svg")}
                    alt=""
                    aria-hidden
                    className="size-[12px] shrink-0"
                  />
                  <span className="text-[8px] font-normal leading-[10.4px] text-[#D9D9D9]">
                    {shortDateLabel(startsAt)}
                  </span>
                </span>
                <span className="text-[16px] font-bold leading-[20.8px] text-white">
                  {clockLabel(startsAt)}
                </span>
              </div>
            )}
            {startsAt && (
              /* `Frame 2147230649` — 2/4 padding on a full radius, #9F5AFF at 9%.
               Its label is 5px in the file; see the note at the top of this
               file for why it is drawn at 8. */
              /*
                "WAITING FOR HOST" IS NOT SAID TO THE HOST.

                Past its time and unopened, the countdown stops promising and
                says the room is waiting on somebody — which is true, and
                addressed to the wrong person when that somebody is reading it.
                ogazboiz hit exactly this: his own scheduled room telling him it
                was waiting for a host, with nothing on the card to act on.

                So the host is told what to DO instead. The countdown itself is
                unchanged for everybody else.
              */
              <span className="whitespace-nowrap rounded-full bg-[rgba(159,90,255,0.09)] px-[4px] py-[2px] text-[8px] font-medium leading-[10.4px] text-[#9F65FD]">
                {mine ? "Yours to open" : startsInLabel(startsAt)}
              </span>
            )}
          </div>

          {/* `Olive Button` — 19 tall, 8.83/4.415 padding, 4 gap, the create ramp. */}
          {/*
            SHARE THE CARD, NOT THE LINK.

            This opened a sheet offering a URL, and a URL in a WhatsApp thread
            is a grey rectangle somebody has to trust before they tap it. The
            picture IS the invitation — cover, name, start time, host, and a QR
            for anyone reading it over a shoulder (nodes 2225:20203 / 20207).

            It falls back to the link where a browser will not share a file,
            and to a download where there is no share sheet at all, so nothing
            that worked before stopped working.
          */}
          <button
            type="button"
            onClick={() => setSharing(true)}
            className="ws-press pointer-events-auto flex h-[19px] items-center gap-[4px] rounded-full bg-[linear-gradient(180deg,#9f65fd_0%,#5b05e6_100%)] px-[8.83px] text-[8px] font-medium leading-[10.4px] text-white transition-opacity hover:opacity-90"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- the node's own export */}
            <img
              src={asset("/gist-rooms/card-share.svg")}
              alt=""
              aria-hidden
              className="size-[10px] shrink-0"
            />
            Share
          </button>
        </div>
      </div>

      {/*
        `Frame 2147230802`'s STROKE — 0.552 INSIDE, white at 18%, on the 16
        radius. Drawn LAST so it lands on top of the cover and the scrim, which
        is the only way an edge this thin survives a card whose children go
        full bleed (ogazboiz, 2026-09-23: "even for coming soon there is border
        line").

        An overlay rather than a `border`: a real border would sit OUTSIDE the
        0.552 and round differently against the radius, and it would take part
        in layout — every inner offset on this card is measured from the node's
        own edges, so a border would move all of them by half a pixel.

        `pointer-events-none` so it never sits between a reader and the title
        link or the Share button underneath it.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[16px] shadow-[inset_0_0_0_0.552px_rgba(255,255,255,0.18)]"
      />

      {sharing && (
        <ShareSheet
          open
          onClose={() => setSharing(false)}
          title="Share gist room"
          payload={{ text: `${stream.title} on Square`, url: share.roomUrl }}
          card={{ imageUrl: share.imageUrl, fileName: share.fileName }}
        />
      )}


    </div>
  );
}
