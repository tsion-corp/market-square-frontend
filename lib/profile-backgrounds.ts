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
  ─── WHAT A PROFILE WEARS, AND WHERE IT IS KEPT ─────────────────────────────
  A cover is TWO choices — the ground and the character standing on it — and
  they live together in `avatarConfig`, the one field that will accept them.

  NOT `coverUrl`, and not for want of trying. That field is validated
  `z.string().url()` (a relative path 400s) and then run through
  `verifyAttachment`, which demands a picture THIS PERSON UPLOADED and refuses
  a foreign host or an appended query string outright (403). Both walls were hit
  and both are correct — an unverified cover URL is a tracking beacon wearing a
  photograph. `coverUrl` still holds an uploaded photograph, which is the one
  thing it is for; it simply cannot hold a choice of ours.

  `avatarConfig` is opaque by contract: the service stores the characters and
  has no opinion, so the encoding can change here without a migration.
*/

export interface AvatarCover {
  /** The ArkPlay share code of the character, or null for the mascot. */
  code: string | null;
  /** A curated background id, or null for the ARK sweep / an upload. */
  background: string | null;
}

/**
 * What goes in `avatarConfig`.
 *
 * A bare code when there is no background — the shortest form, and what every
 * avatar saved before backgrounds existed already looks like. JSON only when
 * there is something more to say. The service caps the STORED STRING at 1024,
 * so the wrapper counts; a code is ~250 and the wrapper is ~20.
 */
export function encodeAvatarCover({ code, background }: AvatarCover): string | null {
  if (!code && !background) return null;
  if (code && !background) return code;
  return JSON.stringify({ c: code ?? null, bg: background ?? null });
}

/**
 * Read it back, including the bare-code form.
 *
 * Anything unrecognised answers empty rather than throwing: this value is
 * replayed from a profile that may have been written by an older client, and
 * a cover that cannot be parsed should fall back to the mascot, not blank the
 * page.
 */
export function decodeAvatarCover(value: string | null | undefined): AvatarCover {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return { code: null, background: null };

  if (!trimmed.startsWith("{")) {
    return { code: isShareCode(trimmed) ? trimmed : null, background: null };
  }
  try {
    const parsed = JSON.parse(trimmed) as { c?: unknown; bg?: unknown };
    const code = typeof parsed.c === "string" && isShareCode(parsed.c) ? parsed.c : null;
    const bg =
      typeof parsed.bg === "string" && PROFILE_BACKGROUNDS.some((b) => b.id === parsed.bg)
        ? parsed.bg
        : null;
    return { code, background: bg };
  } catch {
    return { code: null, background: null };
  }
}

/**
 * The background a profile is actually wearing, as a URL to draw.
 *
 * Three sources in order: the curated background they picked, the photograph
 * they uploaded (`coverUrl`, which is what that field is for), and the ARK
 * sweep everybody starts with.
 */
export function coverBackgroundUrl(
  background: string | null | undefined,
  uploadedCoverUrl?: string | null,
): string {
  if (background && PROFILE_BACKGROUNDS.some((b) => b.id === background)) {
    return backgroundUrl(background);
  }
  const upload = typeof uploadedCoverUrl === "string" ? uploadedCoverUrl.trim() : "";
  return upload || defaultBackgroundUrl();
}
