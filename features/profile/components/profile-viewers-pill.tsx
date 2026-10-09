"use client";

import { asset } from "@/lib/square-path";

/**
 * "WHO VIEWED MY PROFILE" — node 2179:19193, in the handle row.
 *
 * The file draws it beside the @handle and the KASH chip (node 2179:19188, a
 * row with a 12 gap), on the owner's own cover. It was absent for a long time
 * for a good reason — the routes did not exist here — and the reason has gone:
 * the service answers `GET /me/profile-views`, and the tab behind this pill is
 * built.
 *
 * ─── THE NODE'S OWN NUMBERS ─────────────────────────────────────────────────
 * 163 x 24 at a full round, on the create ramp exactly as the file writes it
 * (`#9F65FD → #5B05E6` at 90deg, which is `--color-create → --color-create-deep`
 * rather than a third purple), carrying the file's two small shadows. Inside:
 * the exported 16px eye, 4 apart from the label, and the label at Geist
 * SemiBold 11/16 in white. Padding 4 / 12.
 *
 * The width is NOT fixed to 163. That measurement is the file's text at the
 * file's rendering; ours sets its own and a hard width would clip the label on
 * a narrower face or leave a gap on a wider one. The padding and the type are
 * the spec; the box follows them.
 *
 * ─── IT IS A BUTTON, NOT A LINK ─────────────────────────────────────────────
 * The viewers list is a panel on this same page, so sending somebody to a URL
 * would reload the profile they are already standing on.
 *
 * It lives in the PROFILE slice rather than `components/layout` because it
 * crosses nothing: a glyph, a label and a callback. Only surfaces that must
 * join two slices belong in the composition layer.
 */
export function ProfileViewersPill({
  count,
  onOpen,
}: {
  /**
   * People in the 90-day window, or null.
   *
   * NULL IS NOT ZERO: the service answers null while the reader browses
   * privately, which is the reciprocal rule rather than an absence of viewers.
   * Either way the pill reads the same — it is a door, not a scoreboard, and a
   * "0" beside it would be a claim the number does not make.
   */
  count: number | null;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={
        typeof count === "number"
          ? `Who viewed my profile, ${count} in the last 90 days`
          : "Who viewed my profile"
      }
      className="ws-press inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-[linear-gradient(90deg,var(--color-create)_0%,var(--color-create-deep)_100%)] px-1.5 text-[11px] font-semibold leading-4 text-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.1),0px_1px_3px_0px_rgba(0,0,0,0.1)] transition-opacity hover:opacity-90 md:px-3"
    >
      {/* The file's own exported glyph, not an icon-library eye. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset("/icons/profile/eye-viewers.svg")}
        alt=""
        aria-hidden
        className="size-4 shrink-0"
      />
      {/*
        THE LABEL IS DESKTOP-ONLY — the glyph carries it on a phone.

        At 393 the full pill is wider than what is left of the handle row, so it
        wrapped onto a line of its own and lay across the character on the
        cover. An eye is already the convention for "who looked", the button
        keeps its full name for assistive technology through `aria-label`, and
        the count stays visible at both sizes because the number is the reason
        to press it.
      */}
      <span className="hidden whitespace-nowrap md:inline">Who viewed my profile</span>
      {/*
        Absent rather than zero while the reader browses privately — see the
        prop. On a phone this is the only text, so it keeps its own padding.
      */}
      {typeof count === "number" && count > 0 && (
        <span className="tnum rounded-full bg-white/20 px-1.5 leading-4">{count}</span>
      )}
    </button>
  );
}
