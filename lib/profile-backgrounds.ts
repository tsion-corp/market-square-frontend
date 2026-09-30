import { asset } from "./square-path.ts";

/*
  THE GROUND A PROFILE'S CHARACTER STANDS ON.

  The cover is layered rather than one flat picture — a background, then the
  character over it — which is what lets a person change one without touching
  the other. This module owns the background half: the curated set, and the
  rule for deciding which one a profile is wearing.

  ─── WHY SVG AND NOT PHOTOGRAPHS ────────────────────────────────────────────
  Each is about a kilobyte, scales to any card without a crop decision, and
  carries no faces, places or licences. A set of stock photographs would be
  megabytes, would need art direction per size, and would put somebody else's
  picture behind every one of our users.

  ─── WHY THEY ARE DARK ──────────────────────────────────────────────────────
  White furniture sits over this — a display name, a handle, three controls —
  and the cover already draws two scrims to keep that readable. A pale
  background would fight both.
*/

export interface ProfileBackground {
  id: string;
  /** What a person picking one sees. */
  label: string;
}

/**
 * The set, in the order it is offered.
 *
 * ORDER AND IDS ARE A CONTRACT. An id is stored on a profile as part of a URL,
 * so renaming one silently takes a background away from everybody wearing it.
 * Add to the end; never rename, never reorder for taste.
 */
export const PROFILE_BACKGROUNDS: readonly ProfileBackground[] = [
  { id: "violet", label: "Violet" },
  { id: "midnight", label: "Midnight" },
  { id: "ember", label: "Ember" },
  { id: "mint", label: "Mint" },
  { id: "rose", label: "Rose" },
  { id: "slate", label: "Slate" },
];

/** Where a curated background lives. */
export function backgroundUrl(id: string): string {
  return asset(`/profile/backgrounds/${id}.svg`);
}

/**
 * The ARK sweep every profile wore before anyone could choose.
 *
 * It stays the default rather than becoming a seventh option, because it is
 * what somebody who has never opened the picker is already wearing — making it
 * selectable would let them "choose" the thing they already have and see
 * nothing happen.
 */
export function defaultBackgroundUrl(): string {
  return asset("/profile/ark-cover-bg.jpg");
}

/**
 * The background a profile is actually wearing.
 *
 * A stored cover can be a curated background, an uploaded picture, or absent.
 * All three resolve here so no caller has to decide, and an EMPTY string is
 * treated as absent — a blank is how a cleared field arrives, and rendering it
 * would produce a broken image rather than the default.
 */
export function coverBackgroundUrl(coverUrl: string | null | undefined): string {
  const trimmed = typeof coverUrl === "string" ? coverUrl.trim() : "";
  return trimmed ? trimmed : defaultBackgroundUrl();
}

/**
 * Which curated background a stored cover is, if it is one at all.
 *
 * The picker needs it to show what is currently chosen. An uploaded picture
 * answers null — it is a real cover, just not one of ours, and pretending it
 * matched would tick a swatch the person never picked.
 */
export function selectedBackgroundId(coverUrl: string | null | undefined): string | null {
  if (typeof coverUrl !== "string") return null;
  const found = PROFILE_BACKGROUNDS.find((bg) => coverUrl === backgroundUrl(bg.id));
  return found ? found.id : null;
}
