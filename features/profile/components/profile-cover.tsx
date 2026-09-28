"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { atHandle } from "@/lib/handle";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { ImageViewer } from "@/components/ui/image-viewer";
import { VerifiedBadge } from "@/components/ui/badge";
import { IconProfileBack } from "@/components/ui/profile-icons";
import { canGoBack } from "@/lib/nav-history";
import { artworkForSeed, resolveSeed } from "@/lib/avatar-seed";
import type { Profile } from "@/lib/api/schemas";
import { asset, sq } from "@/lib/square-path";

/**
 * THE PROFILE COVER — node 435:27500, redrawn as 1021:20229 (live file,
 * updated 2026-09-11): the avatar carries a camera button on your own profile,
 * and the actions sit on the identity row's FOOT, 5 above the avatar's.
 *
 * A 741x473 card at a 20 radius with the cover photograph filling it, the
 * person's identity laid over its foot, and the actions held at the right. It
 * replaced the X pattern: a `ColumnHeader`, then a full-bleed banner, then an
 * avatar hanging off its lower edge into the content below. Three separate
 * bands where the file draws one object.
 *
 * ─── THE TWO SCRIMS ARE VERTICAL, AND THE PROPERTIES SAY OTHERWISE ──────────
 * 435:27501 and 435:27502 both report gradient handles running (1.694, 0.499)
 * to (0.069, 0.499) — a horizontal axis, right to left, on unrotated
 * rectangles. Rendered, they are unmistakably vertical: sampling the export
 * down the top strip gives luminance 109 -> 234 with left, middle and right
 * within nine of each other, and up the bottom strip 246 -> 57 the same way.
 * The render wins. Their alphas come from the same samples — about 0.6 at the
 * top edge and 0.8 at the bottom — rather than the flat 1.0 the stops claim,
 * which would have blacked out the photograph entirely.
 *
 * The scrims exist so the white furniture over them stays readable on a
 * photograph nobody has seen yet. They are `aria-hidden` decoration.
 */
export function ProfileCover({
  profile,
  actions,
  meta,
  onChangePhoto,
}: {
  profile: Profile;
  /**
   * Your own profile only: the camera button on the avatar (1097:23670), a 32
   * disc on the create ramp over white, 12 past the avatar's right edge and 8
   * below its foot. Absent on somebody else's.
   */
  onChangePhoto?: () => void;
  /** Edit Profile on your own, follow/wink/message on somebody else's. */
  actions?: React.ReactNode;
  /**
   * The row beside the handle — node 435:27521.
   *
   * The file draws two things here: a balance chip and a "Who viewed my
   * profile" pill on the create ramp. Only the chip is passed, and only on your
   * own profile.
   *
   * WHO VIEWED MY PROFILE IS NOT DRAWN. It is a whole capability, not a style:
   * it needs somewhere that records a profile view and somewhere that lists
   * them back, and the service has neither — `/posts/:id/views` counts POST
   * views and is the only view route on the contract. A pill that opens
   * nothing, or opens an empty list, is a promise the product cannot keep, so
   * it is absent until the routes exist rather than shipped dead. Requested.
   */
  meta?: React.ReactNode;
}) {
  const router = useRouter();
  const name = profile.displayName || profile.username;

  /*
    THE FILE'S COVER, DRAWN AS ONE PICTURE. From md the furniture over the photo
    (Back, the identity row, the actions) is laid out at the node's own 741x473
    and scaled to the card's real width, so everything sits exactly where
    1021:20868 puts it — actions at the identity row's foot, the handle, KASH and
    "Who viewed my profile" on one row — while the column keeps the rail beside
    it (535 wide at 1440, a 0.72 scale). Below md the phone layout stands.
  */
  const cardRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  /* The picture open full screen, if any: the profile picture or the cover. */
  const [viewing, setViewing] = useState<{ src: string; alt: string } | null>(null);
  /*
    THE COVER IS HARD-CODED FOR NOW — node 2102:18362 (2026-09-28): the ARK
    mascot standing on the orange checkered sweep, composed from the node's own
    raster layers at its exact geometry (bg crop offset −300.94/−118.02, the
    1024² mascot cut-out at 293² @ 133.5,63) and baked at 3x to
    `public/profile/ark-cover.jpg`. EVERY profile wears it — `coverUrl` is
    deliberately not read — until the avatar system ogazboiz's teammate is
    building ships and profiles get generated covers of their own. The person's
    own PROFILE PICTURE (the rounded tile below) is untouched and still theirs
    to change. To restore user covers: `profile.coverUrl ?? asset(…)` again.
  */
  const coverSrc = asset("/profile/ark-cover.jpg");
  const avatarSrc = profile.avatarUrl ?? artworkForSeed(resolveSeed({ id: profile.id, name }));
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const md = window.matchMedia("(min-width: 48rem)");
    const measure = () => setScale(md.matches ? Math.min(1, el.clientWidth / 741) : null);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    md.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      md.removeEventListener("change", measure);
    };
  }, []);

  return (
    /*
      The file's 741x473 holds on desktop. On a phone that ratio gives a
      218px card into which a 72 avatar, a name, a handle and three controls
      cannot fit side by side — the handle ended up one letter per line down
      the left edge. So the phone cover is 300 tall and stacks the identity
      above the actions; `md:` returns the file's frame.
    */
    <div ref={cardRef} className="relative h-[300px] w-full overflow-hidden rounded-[20px] md:aspect-[741/473] md:h-auto">
      {/* THE COVER IS LAYERED, not one flat picture, so the mascot's head can
          be swapped per user (the seeded-avatar personalisation ogazboiz is
          building toward). Layer 1: the orange checkered sweep, baked from the
          node's own raster at its exact crop (offset −300.94/−118.02).
          Layer 2: the 1024² transparent mascot cut-out — the very bitmap the
          file's SVG wraps — positioned by the node's geometry: a 293² box at
          (133.5, 63) in the 535×342 frame → centre-x 52.34%, height 85.67%,
          its feet 4.09% below the card edge (the frame clips them, as the
          file does). Layer 3 (coming): the per-seed HEAD overlay. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset("/profile/ark-cover-bg.jpg")}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset("/profile/ark-mascot.png")}
        alt=""
        aria-hidden
        className="absolute w-auto max-w-none -translate-x-1/2"
        style={{ left: "52.336%", bottom: "-4.094%", height: "85.673%" }}
      />

      {/* 108 of 473 at the top, 215 at the foot — see the note above for why
          these are vertical and why the alphas are not the stops' 1.0. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[22.8%] bg-[linear-gradient(180deg,rgba(0,0,0,0.6)_0%,rgba(0,0,0,0)_100%)]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[45.5%] bg-[linear-gradient(0deg,rgba(0,0,0,0.8)_0%,rgba(0,0,0,0)_100%)]"
      />

      {/* Tap the cover to see it whole ("even the background picture"). The
          layer above lets taps through except on its own controls. */}
      <button
        type="button"
        onClick={() => setViewing({ src: coverSrc, alt: "Cover photo" })}
        aria-label="View cover photo"
        className="absolute inset-0 cursor-zoom-in"
      />

      <div
        className="pointer-events-none absolute inset-0 md:inset-auto md:left-0 md:top-0 md:h-[473px] md:w-[741px] md:origin-top-left"
        style={scale === null ? undefined : { transform: `scale(${scale})` }}
      >
      {/* 435:27537 — 24 in and 24 down, the same labelled Back the gist room
          carries. Inside the card, over the scrim, not above it in a column
          header. */}
      <button
        type="button"
        onClick={() => (canGoBack() ? router.back() : router.push(sq("/")))}
        className="ws-press pointer-events-auto absolute left-6 top-6 z-10 flex items-center gap-2 text-[16px] leading-6 text-white transition-opacity hover:opacity-80"
      >
        {/* 545:47613 — the file's own `arrow-left` at 20, not the shared chevron. */}
        <IconProfileBack className="h-5 w-5 shrink-0" />
        Back
      </button>


      {/* 435:27503 — the identity, 24 from the left and 24 from the foot. */}
      {/* 545:47576 (the identity, y=377..449) and 545:47603 (the actions,
          y=394..432): the actions are CENTRED on the identity row, not hung
          from its foot. */}
      {/* ONE ROW AT EVERY WIDTH — identity on the left, controls on the right.
          On a phone the controls are icons only (the Wink pill and Edit Profile
          drop their labels below md) and the avatar and name step down a size,
          so the row fits 358 with the name still readable. */}
      <div className="pointer-events-auto absolute inset-x-4 bottom-4 z-10 flex items-center gap-3 md:inset-x-6 md:bottom-6 md:items-end md:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 md:gap-4">
          {/* 72 at a 16.36 radius behind a 2.18 ring in #15202B at 40%. A
              ROUNDED SQUARE, not the circle every other avatar in the app is:
              the file draws the profile's own portrait differently from the one
              in a row, and this is the only place that holds. */}
          {/* On the row's FOOT from md: our column is narrower than the file's,
              so a name with chips can wrap taller than the avatar, and the
              actions are measured against the avatar's foot, not the text's. */}
          <span className="relative block shrink-0 md:self-end">
            <button
              type="button"
              // The picture ON SCREEN: the upload, or the seeded mascot the
              // avatar draws when there is none — a tap on either opens it.
              onClick={() => avatarSrc && setViewing({ src: avatarSrc, alt: `${name}'s profile picture` })}
              disabled={!avatarSrc}
              aria-label="View profile picture"
              className="block cursor-zoom-in rounded-[16.36px] disabled:cursor-default"
            >
              <Avatar
                name={name}
                seed={profile.id}
                src={profile.avatarUrl}
                size={72}
                sizeClassName="h-14 w-14 md:h-[72px] md:w-[72px]"
                className="shrink-0 rounded-[16.36px] ring-[2.18px] ring-[#15202B]/40"
              />
            </button>
            {onChangePhoto && (
              <button
                type="button"
                onClick={onChangePhoto}
                aria-label="Change profile photo"
                className="ws-press absolute -bottom-2 -right-3 h-8 w-8 rounded-full"
              >
                {/* The node's own export: the disc, its ramp and the camera. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset("/profile/camera-button.svg")} alt="" aria-hidden className="block h-8 w-8" />
              </button>
            )}
          </span>
          {/* `flex-1` as well as `min-w-0`: without it the column sizes to
              its content and the name's chips run past the cover's edge on a
              phone instead of wrapping under the name. */}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {/* 545:47580 — the name, then its chips, 8 apart, on one row in a
                column the file fixes at 377. Our column is narrower (600
                against the file's 805) and a profile can carry two chips
                where the file draws one, so the chips WRAP under the name
                when they must. The name itself never truncates: it is the
                person's, and "og…" is not a name. */}
            <h1 className="flex min-w-0 flex-wrap items-center gap-2 text-[20px] font-bold leading-7 text-white md:text-[24px] md:leading-8">
              <span className="min-w-0 break-words">{name}</span>
              <VerifiedBadge verification={profile.verification} className="h-5 w-5" />
              {/* No creator badge on the profile ("remove that creator badge in
                  profile", ogazboiz). `role` still decides who can go live. */}
            </h1>
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              {/* An unclaimed member has no handle to show — their `username`
                  is the Privy DID the schema falls back to so LINKS resolve,
                  and printing it gave this line forty-odd unbroken characters
                  that only `break-all` could cope with. Nothing is drawn now;
                  the display name above already names them. */}
              {atHandle(profile.username) && (
                <span className="text-[14px] leading-5 text-white/50 md:text-[16px] md:leading-6">
                  {atHandle(profile.username)}
                </span>
              )}
              {meta}
            </div>
          </div>
        </div>

        {/* 1021:20260 — 16 apart, their foot 5 above the avatar's (444 vs 449). */}
        {actions && <div className="flex shrink-0 items-center gap-2 md:mb-[5px] md:gap-4">{actions}</div>}
      </div>
      </div>
      {viewing && <ImageViewer src={viewing.src} alt={viewing.alt} onClose={() => setViewing(null)} />}
    </div>
  );
}
