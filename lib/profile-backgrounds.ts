import { asset } from "./square-path.ts";
import { isShareCode } from "./arkplay-avatar.ts";

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

/*
  ─── WHAT A STORED COVER ACTUALLY IS ────────────────────────────────────────
  A cover is TWO choices — the ground and the character standing on it — and
  the profile has one field to keep them in. So the stored value is an absolute
  URL naming the ground, carrying the character's share code as `?c=`.

  THE CHARACTER IS NOT THE PROFILE PICTURE. It used to be read out of
  `avatarUrl`, which meant building a character silently replaced the person's
  photograph with it. They are separate things in the design and separate here:
  the studio writes the cover and never touches the picture.

  ABSOLUTE, BECAUSE THE SERVICE INSISTS. `coverUrl` is validated with
  `z.string().url()`, which rejects a relative path — a curated background
  saved as `/profile/backgrounds/violet.svg` answers 400 and the choice never
  persists. Verified against the service's own schema.

  READ BY PATH, BECAUSE ORIGINS MOVE. What is written carries whatever origin
  the browser was on — a preview deployment, a local port. Matching the whole
  string would make a background picked on a preview stop being recognised in
  production, so only the PATH decides which one it is.
*/

/** Absolute if the caller gave an origin, and it survives a `?c=` already there. */
function absolute(origin: string, path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  const base = origin.replace(/\/+$/, "");
  /*
    An empty origin is what `window.location.origin` reads as during SSR, and
    joining it produced a relative string that `new URL()` then threw on —
    ERR_INVALID_URL out of a background pick. The placeholder keeps the value
    parseable; `storedCoverUrl` is only ever called from a click handler, where
    a real origin exists.
  */
  return `${base || PARSE_BASE}${path}`;
}

function parsed(coverUrl: string | null | undefined): URL | null {
  const trimmed = typeof coverUrl === "string" ? coverUrl.trim() : "";
  if (!trimmed) return null;
  try {
    // A base is supplied so a legacy RELATIVE value still parses; only the
    // path and query are ever read from the result.
    return new URL(trimmed, PARSE_BASE);
  } catch {
    return null;
  }
}

/** Never returned to a caller — see `coverBackgroundUrl`, which strips it. */
const PARSE_BASE = "https://square.invalid";

/**
 * The cover as it is STORED — the one value the profile keeps.
 *
 * `null` means wearing nothing of one's own: the ARK sweep and the mascot,
 * which is what somebody who has never opened the picker already has.
 */
export function storedCoverUrl(
  origin: string,
  backgroundId: string | null,
  characterCode: string | null,
): string | null {
  if (!backgroundId && !characterCode) return null;
  const url = new URL(
    absolute(origin, backgroundId ? backgroundUrl(backgroundId) : defaultBackgroundUrl()),
  );
  if (characterCode) url.searchParams.set("c", characterCode);
  return url.toString();
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
  const url = parsed(coverUrl);
  if (!url) return defaultBackgroundUrl();
  const id = selectedBackgroundId(coverUrl);
  if (id) return backgroundUrl(id);
  if (CURATED_DEFAULT.test(url.pathname)) return defaultBackgroundUrl();
  /*
    An uploaded picture — somebody else's URL, kept as it is. The character
    parameter is ours and is dropped: a media host handed a query it never
    issued can answer 403 for a signed URL, and the picture is the point here.
  */
  url.searchParams.delete("c");
  /*
    THE PARSE BASE MUST NOT LEAK. A relative stored cover (an upload URL that
    is not absolute) came back as "https://square.invalid/uploads/me.jpg" — a
    host that does not exist, rendered as a broken image. Only the origin the
    value actually carried belongs in the answer.
  */
  const absoluteInput = /^[a-z][a-z0-9+.-]*:/i.test((coverUrl ?? "").trim());
  return absoluteInput ? url.toString() : `${url.pathname}${url.search}`;
}

const CURATED = /\/profile\/backgrounds\/([A-Za-z0-9_-]+)\.svg$/;
const CURATED_DEFAULT = /\/profile\/ark-cover-bg\.jpg$/;

/**
 * Which curated background a stored cover is, if it is one at all.
 *
 * The picker needs it to show what is currently chosen. An uploaded picture
 * answers null — it is a real cover, just not one of ours, and pretending it
 * matched would tick a swatch the person never picked.
 */
export function selectedBackgroundId(coverUrl: string | null | undefined): string | null {
  const url = parsed(coverUrl);
  const id = url && CURATED.exec(url.pathname)?.[1];
  return id && PROFILE_BACKGROUNDS.some((bg) => bg.id === id) ? id : null;
}

/** The character standing on this cover, or null when it is the mascot's. */
export function coverCharacterCode(coverUrl: string | null | undefined): string | null {
  const code = parsed(coverUrl)?.searchParams.get("c") ?? null;
  return isShareCode(code) ? code : null;
}

/**
 * Whether a cover is wearing the ARK sweep — the ground nobody chose.
 *
 * Not simply "no value" any more: a profile with a character but no chosen
 * background stores the default's own path so the character has something to
 * hang off, and the picker would otherwise read that as an uploaded picture
 * and tick nothing.
 */
export function isDefaultBackground(coverUrl: string | null | undefined): boolean {
  const url = parsed(coverUrl);
  return !url || CURATED_DEFAULT.test(url.pathname);
}
