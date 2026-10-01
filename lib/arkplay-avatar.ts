/*
  THE ARKPLAY AVATAR SERVICE, AS SQUARE USES IT.

  An avatar is not a picture here: it is a share code, and every picture is a
  pure function of it. So Square stores a string and points an <img> at a URL —
  no engine in the bundle, no renderer to run, no images to generate or host.

  ─── NOTHING HERE NEEDS A CREDENTIAL ────────────────────────────────────────
  Render URLs are public and cacheable; verified against the live service
  before this was written. The developer key ArkPlay issues is a SERVER-side
  secret for quota and attribution, and it must never be put in a URL the
  browser builds — a key in an <img src> is a key in every proxy log between
  here and the user.
*/

/** Where the service lives. Overridable so a staging service can be pointed at
    without a code change; the default is the one that is live today. */
const ARKPLAY_ORIGIN = (
  process.env.NEXT_PUBLIC_ARKPLAY_URL ?? "https://game-server.tsionark.com"
).replace(/\/+$/, "");

const API = `${ARKPLAY_ORIGIN}/avatar/v1`;


/** The service's real crop ladder — five, not the two this once named. */
export type AvatarCrop = "portrait" | "full" | "fit" | "bust" | "head";

/**
 * The picture for a share code.
 *
 * `portrait` is the head-and-shoulders used wherever an avatar appears today;
 * `full` is the whole character, which is what stands on a profile cover.
 *
 * `background` is the service's own scene behind the character, and it is ON
 * by default — theirs, not ours. Left alone it returns an RGBA PNG whose
 * corners are an opaque #272F42, so compositing one over a profile background
 * covers that background with a dark rectangle. Every caller that layers the
 * character over something else must pass `background: false`.
 */
export function avatarImageUrl(
  code: string,
  opts: {
    crop?: AvatarCrop;
    size?: number;
    format?: "png" | "svg";
    background?: boolean;
    /** `low` is 1.9x fewer bytes at no extra latency — a bandwidth knob. */
    detail?: "low" | "medium" | "high";
  } = {},
): string {
  const { crop = "portrait", size = 256, format = "png", background, detail } = opts;
  const url = new URL(`${API}/render/${encodeURIComponent(code)}.${format}`);
  url.searchParams.set("crop", crop);
  url.searchParams.set("size", String(size));
  // Only when turning it off: the parameter is absent for the service default,
  // so an ordinary portrait URL stays the short form it has always been and
  // the codes already saved inside one keep matching.
  if (background === false) url.searchParams.set("background", "false");
  if (detail) url.searchParams.set("detail", detail);
  return url.toString();
}

/**
 * THE CHARACTER THAT STANDS ON A PROFILE COVER.
 *
 * The cover is a background with a person's character standing in the middle
 * of it, so this is the cut-out half: the whole figure, and no scene of its
 * own to hide the ground it is standing on.
 *
 * ─── WHY THE FIGURE IS NOT SCALED TO A FIXED HEIGHT ─────────────────────────
 * Measured against the live service across five avatars, a `full` render puts
 * the figure's FEET on the canvas bottom every time — the bottom padding runs
 * 0%..3.1% whatever the character is. What varies is its height: 84.6% of the
 * canvas for a humanoid, 70.9% for a dragon, 37.3% for a slime. That spread is
 * not framing to correct, it is the characters being different sizes, so the
 * cover anchors the canvas's FOOT and lets the figure stand as tall as it is.
 * Normalising every species to one height would stand a slime eye to eye with
 * a dragon.
 */
/*
  1024, NOT 512. A cover draws the character 453 CSS px tall, which is 906
  device pixels on a 2x screen — and the figure is only about 74% of the render
  canvas, so a 512 render supplies 379px and was being blown up 2.4x. That is
  the whole reason it looked soft next to the engine's own studio. 1024 brings
  it to 1.2x; 1536 would be sharper still but costs 6.3s against 1.9s.
*/
/**
 * THE COVER, at the shape of the card rather than a square inside it.
 *
 * Ours, not the service's: every crop the engine offers is square and their
 * HTTP render exposes no way to ask for anything else, so a cover built on it
 * could only letterbox the scene or crop the character out of it. We run the
 * engine ourselves (see app/api/avatar/cover) where a `viewBox` can be widened
 * to the card and the scene fills it.
 *
 * Still a plain, immutable, cacheable <img src> for every visitor — a share
 * code cannot change what it decodes to.
 */
export function coverImageUrl(
  code: string,
  { width = 741, height = 473, anim }: { width?: number; height?: number; anim?: string | null } = {},
): string {
  const q = `w=${width}&h=${height}${anim ? `&a=${encodeURIComponent(anim)}` : ""}`;
  return `/api/avatar/cover/${encodeURIComponent(code)}?${q}`;
}

export function coverCharacterUrl(code: string, size = 1024): string {
  return avatarImageUrl(code, { crop: "full", size, background: false });
}

/**
 * THE CHARACTER *IN THEIR SCENE* — what a cover actually shows.
 *
 * The engine draws the wallpaper, not us: the `scene` section carries 14
 * presets, six background modes, eleven patterns, two colours, a frame and a
 * ring, and all of it rides inside the share code. So a cover needs no second
 * field and no second picture.
 *
 * ─── WHY THIS IS SAFE TO USE FOR EVERYONE ───────────────────────────────────
 * `scene.background: "none"` renders TRANSPARENT even through this, verified
 * against the live service (corner alpha 0, against 255 for every other mode).
 * So one request serves both kinds of cover: somebody with a scene gets it,
 * and somebody without gets a cut-out that composites over whatever ground
 * their profile already had. Nothing has to decode the code to find out which.
 */

/*
  ─── READING THE CODE BACK OUT OF A URL ─────────────────────────────────────
  A person must be able to reopen the editor on the avatar they already have,
  which means recovering the code they saved. Square has nowhere of its own to
  keep it YET — a profile field is agreed and not shipped — but it does not
  need one, because the render URL contains the code by construction.

  This is deliberate and not a trick: the URL is the canonical form of the
  avatar, and reading our own format back is not scraping. When the profile
  field lands it becomes the primary source and this stays as the fallback for
  avatars saved before it existed.
*/
const RENDER_PATH = /\/avatar\/v1\/render\/([^/]+)\.(?:png|svg)$/;

/** The share code inside one of our render URLs, or null for anything else —
    an uploaded photograph, a seeded placeholder, or nothing at all. */
export function codeFromAvatarUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string" || !url) return null;
  try {
    const parsed = new URL(url, ARKPLAY_ORIGIN);
    const match = RENDER_PATH.exec(parsed.pathname);
    if (!match) return null;
    const code = decodeURIComponent(match[1]);
    return isShareCode(code) ? code : null;
  } catch {
    return null;
  }
}


/**
 * Whether a string looks like a share code.
 *
 * Checked before a code is put in a URL or sent to the studio: the studio
 * refuses a malformed one, and a bad code would otherwise surface as a broken
 * image with nothing to explain it. The engine's codes start with a version
 * letter and are base64url from there, so the shape is checkable without
 * decoding — which would need the engine.
 */
export function isShareCode(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{31,2047}$/.test(value);
}
