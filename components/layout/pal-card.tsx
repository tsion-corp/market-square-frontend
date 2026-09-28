"use client";

import Link from "next/link";
import { profileHref } from "@/lib/profile-href";
import { atHandle } from "@/lib/handle";
import { Avatar } from "@/components/ui/avatar";
import {
  IconDeckAdd,
  IconDeckPass,
  IconDeckWink,
  IconPalAdd,
  IconPalPass,
  IconPalWink,
  IconPalWinkOpen,
} from "@/components/ui/home-icons";
import { IconPalCrown } from "@/components/ui/pal-crown";
import { useFollow, useIsFollowing, useWink } from "@/features/profile";
import { useGate } from "@/hooks/use-gate";
import { cn } from "@/lib/cn";
import type { Profile } from "@/lib/api/schemas";

/**
 * THE PAL CARD — one object, two places.
 *
 * The lavender portrait card with a follow badge on its corner, the person's
 * name and handle over the foot of the photograph, and PASS and WINK under the
 * photo. "Make some friends" — on Home and on `/pals` — fans three of them into
 * a deck (node 844:18440); "Suggested Pals to follow nearby you" lays them out
 * in a rail (540:19351). Same card, drawn at two sizes.
 *
 * It is one component because it is one object. Two copies of this markup is
 * how a wink cooldown gets fixed in one place and not the other, and how the
 * follow badge ends up meaning something slightly different on each surface.
 *
 * ─── THE GEOMETRY IS PASSED IN, NOT DERIVED ─────────────────────────────────
 * The rail is not the deck scaled: the card goes 186 → 170.41 (×0.916) but its
 * controls go 36.58 → 41.82 circles, which is LARGER against a smaller card,
 * and the corner radius goes 18.57 → 24 rather than down. So each surface hands
 * over its own file's numbers instead of a scale factor that would be wrong in
 * three places.
 *
 * ─── TWO DRAWINGS OF THE SAME CARD ──────────────────────────────────────────
 * `PalCardGeometry` is the rail's file's drawing: pass, wink and the badge are
 * EXPORTED glyphs that carry their own disc, so the geometry names the box each
 * glyph is drawn in (`controlBox` is the circle divided by 0.795 — the glyph's
 * own padding IS the gap between them — and `controlBottom` is measured to
 * that box).
 *
 * `PalCardNodeGeometry` (`kind: "node-844"`) is node 844:18440's drawing, which
 * the deck uses: the discs are CSS circles in the palette's own purples with
 * the file's glyphs inside them, the badge carries a `#F9F5FF` ring, the two
 * lines are LEFT-aligned at measured offsets, and the card has an outside rim.
 * It is a second geometry, not a second card: every hook, handler, label and
 * guard below is shared, and a surface picks a drawing by the object it passes.
 * The rail keeps the older drawing untouched.
 */
interface PalCardBase {
  /** Card width; the deck's is 543.42 (file units, scaled by the deck), the rail's 170.41. */
  width: number;
  height?: number;
  radius: number;
  photo: { width: number; height: number; left: number; top: number; radius: number };
  /** The black scrim over the foot of the photo, carrying name and handle. */
  scrim: { height: number; name: number; nameLeading: number; handle: number; handleLeading: number };
}

export interface PalCardGeometry extends PalCardBase {
  kind?: undefined;
  badge: { size: number; inset: number };
  /** Box the exported glyph is drawn in — see the note above. */
  controlBox: number;
  controlBottom: number;
}

export interface PalCardNodeGeometry extends PalCardBase {
  kind: "node-844";
  /** An OUTSIDE stroke in the page's own colour (strokeAlign OUTSIDE) — invisible against the page, it shows only where it cuts the card out of the ones behind. */
  rim: number;
  /** The rim's colour — the page's. `#0F0F0F` when absent (Home's reading); `/pals`' node strokes `#121214`, the chrome the shell now paints. */
  rimColor?: string;
  /**
   * The crown beside the name (1331:21359 on `/pals`), in file units: its box,
   * the gap after the name's ink, and how far below the name's cap centre it
   * sits. Drawn only for a verified profile — see `premium` in the body.
   */
  crown?: { width: number; height: number; gap: number; dy: number };
  /** True where the wink face is the file's two-variant component and BLINKS (see `IconPalWinkOpen`). */
  blink?: boolean;
  /** The two lines, left-aligned and placed from the photo's bottom edge. */
  lines: { nameLeft: number; nameBottom: number; handleLeft: number; handleBottom: number };
  /** A solid `--color-spotlight` disc with an INSIDE ring, the glyph centred. */
  badge: {
    size: number;
    right: number;
    top: number;
    ring: number;
    glyph: number;
    /** The ring's colour when it is not `/pals`' `#F9F5FF` — Home's is white. */
    ringColor?: string;
  };
  /** Two CSS circles: `size` each, `gap` apart, `bottom` from the card's foot, with their glyphs at `passGlyph` / `winkGlyph`. */
  controls: {
    size: number;
    gap: number;
    bottom: number;
    passGlyph: number;
    winkGlyph: number;
    /** How far the wink sits ABOVE the pass, when the pair is drawn tilted (Home: 5.59). */
    lift?: number;
  };
}

export function PalCard({
  profile,
  geometry,
  interactive = true,
  onPass,
  onWinked,
  onFollowed,
}: {
  profile: Profile;
  geometry: PalCardGeometry | PalCardNodeGeometry;
  /**
   * False for the deck's cards behind the front one: they are visible but not
   * reachable, so their controls are disabled and their link is out of the tab
   * order rather than being a second target for the same person.
   */
  interactive?: boolean;
  onPass?: () => void;
  onWinked?: () => void;
  /**
   * Fired when the badge FOLLOWS (never on an unfollow), after the follow is
   * sent. The deck steps on it: once you have followed somebody the card has
   * done its job, and on desktop — where there is no swipe to fling it away —
   * a card that stayed put after Follow read as the action not landing.
   */
  onFollowed?: () => void;
}) {
  /*
    THE CROWN beside the name (node 1331:21359 on `/pals`' front card) IS THE
    VERIFIED MARK. ogazboiz decided it on 2026-09-12, after the backend
    confirmed there is no other tier: verification is the platform's one paid
    standing (granted, then kept current by KASH; `lib/api/schemas.ts`), and a
    crown next to a check would be the same fact drawn twice. So the card
    draws the crown on `verified` ONLY — `lapsed` is a verified account whose
    payment ran out and must not carry it, exactly as the silver check rule.
  */
  const premium = profile.verification === "verified";
  /*
    Both hooks are per-PERSON, so they live on the card and not on whatever is
    holding it. `useWink` keeps the service's own 429 wording — the hourly
    budget and "already winked today" are different refusals and only the
    service knows which applied — and goes quiet where the route is not
    deployed. `useIsFollowing` layers this session's intent under the server's
    answer, so a payload without the follow edge can never render a fabricated
    "Following".
  */
  const wink = useWink(profile);
  const follow = useFollow(profile);
  const isFollowing = useIsFollowing(profile);
  const gate = useGate();
  const name = profile.displayName || profile.username;
  // One of these is the drawing in use; the other is null. `g` keeps its
  // name so the older drawing's markup below reads exactly as it did.
  const node = geometry.kind === "node-844" ? geometry : null;
  const g = geometry.kind === "node-844" ? null : geometry;
  const base: PalCardBase = geometry;

  return (
    <div
      className="relative shrink-0"
      style={{ width: base.width, height: base.height }}
    >
      <div
        className="absolute inset-0 bg-[linear-gradient(180deg,#FFFFFF_0%,#D0B3FF_100%)]"
        style={{
          borderRadius: base.radius,
          // The rim is the file's OUTSIDE stroke, so it is drawn outside the
          // box rather than eating into it: a spread shadow, no blur.
          boxShadow: node ? `0 0 0 ${node.rim}px ${node.rimColor ?? "#0F0F0F"}` : undefined,
        }}
      />

      {/*
        "WINKED YOU" — the reason this card is at the front.

        The service's deck now leads with people who have winked the reader
        (`sort=foryou`, band one). Without saying so, the strongest card in the
        deck looks exactly like every other one, and the reader is answering a
        question somebody already asked them without knowing it.

        A JUDGEMENT CALL, stated: the file has no node for this. It is drawn in
        the app's own chip style rather than invented in the card's, and it sits
        in the photo's top-left corner — the one corner the drawing leaves
        empty, opposite the follow control.
      */}
      {profile.winkedMe && (
        <span
          className="absolute z-10 rounded-full bg-spotlight px-2 py-[3px] text-[11px] font-semibold leading-[15px] text-white"
          style={{ left: base.photo.left + 8, top: base.photo.top + 8 }}
        >
          Winked you
        </span>
      )}

      {/*
        FOLLOW — the file's `profile-add`, a real control and not an ornament.

        It overlaps the photo's corner while staying inside the card, and it is
        painted BEFORE the photo in the markup, so `z-10` is load bearing: two
        positioned elements at one z-index paint in DOM order, and without it
        the photograph covers the badge and the control looks like it is inside
        the picture.
      */}
      <button
        type="button"
        disabled={!interactive || follow.isPending}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          gate(() => {
            follow.mutate(!isFollowing);
            // A follow moves the deck on; an unfollow leaves the card where it is.
            if (!isFollowing) onFollowed?.();
          });
        }}
        aria-label={isFollowing ? `Unfollow ${name}` : `Follow ${name}`}
        className={cn(
          "ws-press absolute z-10 transition-opacity hover:opacity-90 disabled:opacity-60",
          // Node 844:23446: a solid disc with a 9.27 INSIDE ring in #F9F5FF —
          // `border-box` sizing keeps the ring inside the file's 107.43.
          node && "flex items-center justify-center rounded-full border-solid border-[#F9F5FF] bg-spotlight"
        )}
        style={
          node
            ? {
                width: node.badge.size,
                height: node.badge.size,
                right: node.badge.right,
                top: node.badge.top,
                borderWidth: node.badge.ring,
                ...(node.badge.ringColor ? { borderColor: node.badge.ringColor } : {}),
              }
            : g
              ? {
                  width: g.badge.size,
                  height: g.badge.size,
                  right: g.badge.inset,
                  top: g.badge.inset,
                }
              : undefined
        }
      >
        {/* Following DIMS the badge rather than removing it: a control that
            vanishes on success leaves no way back. */}
        {node ? (
          <IconPalAdd
            className={cn("shrink-0", isFollowing && "opacity-50")}
            style={{ width: node.badge.glyph, height: node.badge.glyph }}
          />
        ) : (
          <IconDeckAdd className={cn("h-full w-full", isFollowing && "opacity-50")} />
        )}
      </button>

      {/*
        A CARD BEHIND THE FRONT ONE IS A PICTURE, AND A PICTURE IS NOT A LINK.

        This carried `tabIndex={-1}` alone, which takes a back card out of the
        TAB ORDER and does nothing whatever to a tap. So the blurred card at
        the left of the fan — one the reader can barely see and has not chosen
        — opened that person's profile when touched, on both sides. ogazboiz
        hit it from either edge.

        The buttons beside it were already right: they take `disabled`, which
        really does refuse a pointer. Only the card FACE, which is the largest
        target on screen, was left live.

        `aria-disabled` rather than dropping the href: the destination is still
        what this card is about once it comes forward, and the deck re-renders
        the same element rather than swapping it.
      */}
      <Link
        href={profileHref(profile)} prefetch={false}
        tabIndex={interactive ? undefined : -1}
        aria-disabled={interactive ? undefined : true}
        onClick={(event) => {
          if (!interactive) event.preventDefault();
        }}
        className={cn("absolute block overflow-hidden", !interactive && "pointer-events-none")}
        style={{
          left: base.photo.left,
          top: base.photo.top,
          width: base.photo.width,
          height: base.photo.height,
          borderRadius: base.photo.radius,
        }}
      >
        <Avatar
          name={name}
          seed={profile.id}
          src={profile.avatarUrl}
          size={Math.round(base.photo.height)}
          sizeClassName="h-full w-full"
          className="rounded-none border-0 object-cover"
        />
        {/*
          The file's bottom scrim: transparent to solid black, carrying the two
          lines so they read over any photograph.

          Both lines are ROBOTO in the file — 600 for the name, 400 for the
          handle — not the product's Geist. These cards are the same
          purple-gradient object the welcome screens use and the design types
          them the same way, so the exception is kept here and nowhere else.

          Node 844:23437 places the lines LEFT-aligned from the photo's foot —
          the name's glyphs start 50.84 in and the handle's box 58.55 (the file's
          own 8-unit stagger, kept), their line boxes 49.57 and 20.32 above the
          photo's bottom edge. Those are the RENDER bounds solved back through
          Roboto's metrics; the text nodes' own boxes are fixed-height frames
          that report 26 and 18 for 62 and 38 line-heights and cannot be used.
          The rail's drawing centres both lines under a padding.
        */}
        <span
          className={cn(
            "absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_0%,rgba(0,0,0,1)_100%)] font-[family-name:var(--font-roboto)]",
            !node && "flex flex-col items-center justify-end px-2 pb-2"
          )}
          style={{ height: base.scrim.height }}
        >
          {node ? (
            /*
              The name and, when the card is `premium`, the crown after it —
              1331:21359 sits 4 past the name's ink on the node's render (6.4
              file units), its 16.57 box 2 below the cap's centre (3.17 units).
              A flex row rather than an inline glyph so the crown never wraps
              or truncates with the name: the text gives way, the crown stays.
            */
            <span
              className="absolute flex items-center"
              style={{
                left: node.lines.nameLeft,
                right: node.lines.nameLeft,
                bottom: node.lines.nameBottom,
                gap: node.crown?.gap,
              }}
            >
              <span
                className="min-w-0 truncate font-semibold text-white"
                style={{ fontSize: base.scrim.name, lineHeight: `${base.scrim.nameLeading}px` }}
              >
                {name}
              </span>
              {premium && node.crown && (
                <IconPalCrown
                  className="shrink-0"
                  style={{
                    width: node.crown.width,
                    height: node.crown.height,
                    translate: `0 ${node.crown.dy}px`,
                  }}
                />
              )}
            </span>
          ) : (
            <span
              className="w-full truncate text-center font-semibold text-white"
              style={{ fontSize: base.scrim.name, lineHeight: `${base.scrim.nameLeading}px` }}
            >
              {name}
            </span>
          )}
          <span
            className={cn("truncate text-white/50", node ? "absolute block" : "w-full text-center")}
            style={{
              fontSize: base.scrim.handle,
              lineHeight: `${base.scrim.handleLeading}px`,
              ...(node
                ? { left: node.lines.handleLeft, right: node.lines.nameLeft, bottom: node.lines.handleBottom }
                : {}),
            }}
          >
            {atHandle(profile.username)}
          </span>
        </span>
      </Link>

      {/*
        The two controls sit on the gradient under the photo.

        The rail's drawing: they ABUT — the file has pass ending exactly where wink
        begins — because each exported glyph carries its own padding and that
        padding is the gap. Any `gap` there adds a second one. The wink sits
        ~3px higher than the pass in that file; kept rather than
        levelled, it is what gives the pair its slight lift to the right.

        Node 844:23459: a centred row of two 109.38 CIRCLES (cornerRadius 3038
        — there is no squircle here) whose rotated boxes are 137.55, so they sit
        28.17 apart and level. Pass is `--color-create` at 23% behind the
        `#7E3BEB` cross; wink is the create → spotlight ramp, drawn top-to-bottom
        on a span turned the disc's own 17.773° so the ramp runs the disc's full
        diameter exactly as the file's does, with the white face upright.
      */}
      <div
        className="absolute inset-x-0 flex items-center justify-center"
        style={node ? { bottom: node.controls.bottom, gap: node.controls.gap } : g ? { bottom: g.controlBottom, gap: 0 } : undefined}
      >
        <button
          type="button"
          disabled={!interactive}
          onClick={onPass}
          aria-label={`Skip ${name}`}
          className={cn(
            "ws-press shrink-0 transition-opacity hover:opacity-90 disabled:opacity-60",
            node && "relative flex items-center justify-center rounded-full bg-create/23"
          )}
          style={node ? { width: node.controls.size, height: node.controls.size } : g ? { width: g.controlBox, height: g.controlBox } : undefined}
        >
          {node ? (
            <IconPalPass className="shrink-0" style={{ width: node.controls.passGlyph, height: node.controls.passGlyph }} />
          ) : (
            <IconDeckPass className="h-full w-full" />
          )}
        </button>
        <button
          type="button"
          disabled={
            !interactive || wink.isPending || wink.unavailable || wink.refusal !== null
          }
          /* `refusal` is the hook's OWN wording — the per-person cooldown, the
             spent hourly budget, a block, or "this is you" — kept because only
             it knows which of those applied. */
          title={wink.refusal ?? undefined}
          onClick={() =>
            gate(() => {
              wink.send();
              onWinked?.();
            })
          }
          /* The control says its own state: a disabled button whose name is
             still "Wink at …" reads as broken to a screen reader, which QA
             asked for directly (2026-09-18: "disable wink icon if ive already
             winked or matched with someone"). */
          aria-label={wink.winked ? `Already winked at ${name}` : `Wink at ${name}`}
          className={cn(
            "ws-press shrink-0 transition-opacity hover:opacity-90 disabled:opacity-60",
            node ? "relative flex items-center justify-center overflow-hidden rounded-full" : "-translate-y-[3px]"
          )}
          style={
            node
              ? {
                  width: node.controls.size,
                  height: node.controls.size,
                  ...(node.controls.lift ? { translate: `0 -${node.controls.lift}px` } : {}),
                }
              : g
                ? { width: g.controlBox, height: g.controlBox }
                : undefined
          }
        >
          {node ? (
            <>
              <span
                aria-hidden
                className="absolute inset-0 rotate-[17.773deg] rounded-full bg-[linear-gradient(180deg,var(--color-create)_0%,var(--color-spotlight)_100%)]"
              />
              {/*
                The face: the winking frame (206:6943) and, where the file's
                component blinks, the open-eyed frame (206:6942) over it on the
                file's own 0.8s / 0.3s clock — `ws-wink-blink` in globals.css.
                The dim for "already winked" is on the WRAPPER, because the
                animation owns the open layer's opacity.
              */}
              <span
                className={cn("relative block shrink-0", wink.winked && "opacity-60")}
                style={{ width: node.controls.winkGlyph, height: node.controls.winkGlyph }}
              >
                <IconPalWink className="absolute inset-0 h-full w-full" />
                {node.blink && <IconPalWinkOpen className="ws-wink-blink absolute inset-0 h-full w-full" />}
              </span>
            </>
          ) : (
            <IconDeckWink className={cn("h-full w-full", wink.winked && "opacity-60")} />
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * "Make some friends" — node 844:23435, the FRONT card of 844:18440, in the
 * file's own units. `/pals` draws it (Home has its own, below). The deck
 * scales the whole fan by one factor, so these are never rounded to a pixel
 * here.
 *
 * `/pals`' CURRENT node, 1328:1885 (2026-09-12), draws this same card at
 * exactly 0.6248 — its front card 1331:21353 is 339.53 × 448.60 = 543.42 ×
 * 0.6248 by 718 × 0.6248, and every part below scales with it: radius 55.94,
 * photo 309.98 × 325.61 at (15.10, 12.87) radius 51.56, name 22.66 / 38.85,
 * handle 15.96 / 23.94, badge 67.12 with a 5.79 ring and a 44.05 glyph,
 * discs 68.34 turned 17.773° (their boxes 85.94) with a 26.56 cross and a
 * 45.51 face. Read from `size`, never the rotated boxes, and pinned in
 * `lib/deck-layout.test.ts`. Three things are that node's own and not a
 * scale: the rim is `#121214` (the chrome the page is painted), the name
 * carries a crown (1331:21359, on a verified profile), and the face blinks.
 *
 *   card    543.42 × 718, radius 89.53, outside stroke 4.54 (#121214 on /pals)
 *   photo   844:23436  496.13 × 521.15 at 24.18, 20.59, radius 82.52
 *   scrim   844:23437  229.19 tall, black 0 → 100%
 *   name    844:23438  Roboto 600 36.27 / 62.17 — render bounds x 75.02, baseline ~473.5
 *   handle  844:23440  Roboto 400 25.55 / 38.32 at 50% — box x 82.73
 *   badge   844:23446  107.43 at right 23.27, top 20.59; ring 9.27 INSIDE; glyph 70.5
 *   discs   844:23459  two 109.38 circles, centres ±68.78 from the middle,
 *           88.8 above the foot (the middle of the 176.26 band under the photo)
 *
 * The line offsets are from the photo's bottom (541.74): the name's 62.17 line
 * box ends at 492.17 and the handle's at 521.42. The scrim's 3.5 units of
 * spill past the photo's bottom in the file are not drawn — the render shows
 * none, the photo's corners clip it.
 */
export const DECK_CARD: PalCardNodeGeometry = {
  kind: "node-844",
  width: 543.42,
  height: 718,
  radius: 89.53,
  rim: 4.54,
  /** 1331:21353 strokes `#121214` — `--color-chrome`, which is what the shell paints the page. */
  rimColor: "var(--color-chrome)",
  photo: { width: 496.13, height: 521.15, left: 24.18, top: 20.59, radius: 82.52 },
  scrim: { height: 229.19, name: 36.27, nameLeading: 62.17, handle: 25.55, handleLeading: 38.32 },
  lines: { nameLeft: 50.84, nameBottom: 49.57, handleLeft: 58.55, handleBottom: 20.32 },
  badge: { size: 107.43, right: 23.27, top: 20.59, ring: 9.27, glyph: 70.5 },
  controls: { size: 109.38, gap: 28.17, bottom: 34.11, passGlyph: 64.75, winkGlyph: 72.84 },
  /** 1331:21359: 16.27 × 16.57 at the node's 0.6248, 4 past the name's ink and 2 below the cap's centre on its render. */
  crown: { width: 26.04, height: 26.53, gap: 6.4, dy: 3.17 },
  blink: true,
};

/**
 * "Make some friends" ON HOME — node 647:16329, the front card of 647:16300 in
 * the live file (647:16288, updated 2026-09-10), in its own units.
 *
 * Home's own drawing, not `DECK_CARD` scaled: its foot is taller (422.24 for a
 * 310.24 card), its rim thicker (5.07), its badge ring white, and its two
 * discs larger in proportion and TILTED as a pair — the wink sits 5.59 above
 * the pass, both turned the same 17.77deg. Disc centres come from the nodes'
 * `relativeTransform`: pass (117.59, 366.21) and wink (193.75, 360.62), 60.55
 * across, so 15.61 apart and the pass's foot 25.76 above the card's.
 *
 * THE LINES ARE PLACED BY THEIR INK, as `/pals`' are. The file's name box is a
 * fixed 155.87 with the name centred inside it, which a name of any other
 * length would not survive, so both lines are left-aligned from the photo's
 * foot. The ink was converted to line boxes with Roboto's metrics measured in
 * Chrome at the file's sizes: the name's line box ends 11.76 below its ink,
 * the handle's 2.90 below its "@". Name ink: 29.42 in, 38.73 above the foot;
 * handle ink: 34.66 in, 14.84 above.
 */
export const HOME_DECK_CARD: PalCardNodeGeometry = {
  kind: "node-844",
  width: 310.24,
  height: 422.24,
  radius: 50,
  rim: 5.07,
  photo: { width: 283.92, height: 298.24, left: 13.08, top: 12, radius: 47.22 },
  scrim: { height: 129.67, name: 20.98, nameLeading: 35.97, handle: 14.78, handleLeading: 22.17 },
  lines: { nameLeft: 28.98, nameBottom: 26.97, handleLeft: 33.87, handleBottom: 11.94 },
  badge: { size: 66.08, right: 12.32, top: 12.32, ring: 5.07, glyph: 38.55, ringColor: "#FFFFFF" },
  controls: { size: 60.55, gap: 15.61, bottom: 25.76, passGlyph: 35.84, winkGlyph: 40.32, lift: 5.59 },
};

/**
 * "Suggested Pals to follow nearby you" — node 540:19353, verbatim.
 *
 * `controlBox` is 52.6 for the file's 41.82 circle (41.82 / 0.795, the glyph's
 * own padding), and `controlBottom` 4.46 is the file's 9.85 to the circle less
 * the 5.39 that padding adds on each side.
 */
export const RAIL_CARD: PalCardGeometry = {
  width: 170.41,
  height: 231.92,
  radius: 24,
  photo: { width: 148.17, height: 155.64, left: 11.07, top: 14.77, radius: 24.64 },
  scrim: { height: 67.67, name: 10.95, nameLeading: 18.77, handle: 7.71, handleLeading: 11.57 },
  badge: { size: 36.3, inset: 6.77 },
  controlBox: 52.6,
  controlBottom: 4.46,
};
