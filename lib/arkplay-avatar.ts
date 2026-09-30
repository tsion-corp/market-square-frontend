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

/** Where the editor is hosted. */
export function studioUrl(origin: string, code?: string | null): string {
  const url = new URL(`${ARKPLAY_ORIGIN}/avatar/studio/`);
  url.searchParams.set("embed", "1");
  // The studio checks this to decide who it may postMessage back to, so it is
  // the caller's real origin and never a guess.
  url.searchParams.set("origin", origin);
  if (code) url.searchParams.set("code", code);
  return url.toString();
}

export type AvatarCrop = "portrait" | "full";

/**
 * The picture for a share code.
 *
 * `portrait` is the head-and-shoulders used wherever an avatar appears today;
 * `full` is the whole character, which is what stands on a profile cover.
 */
export function avatarImageUrl(
  code: string,
  opts: { crop?: AvatarCrop; size?: number; format?: "png" | "svg" } = {},
): string {
  const { crop = "portrait", size = 256, format = "png" } = opts;
  const url = new URL(`${API}/render/${encodeURIComponent(code)}.${format}`);
  url.searchParams.set("crop", crop);
  url.searchParams.set("size", String(size));
  return url.toString();
}

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

/** Whether this profile's picture is a generated avatar rather than a photo. */
export function isGeneratedAvatar(url: string | null | undefined): boolean {
  return codeFromAvatarUrl(url) !== null;
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
