/**
 * WHAT A TEXT STORY LOOKS LIKE — the background it plays on and the face it is
 * set in.
 *
 * `storyStyle` is `{ background, font }` on a post, or null, and it has been on
 * the service for weeks with nothing reading or writing it: every story this app
 * made played on one hard-coded violet gradient, and a story made anywhere else
 * rendered as if it had no style at all.
 *
 * ─── BOTH HALVES OR NEITHER ─────────────────────────────────────────────────
 * Rendering alone would have been pointless here — this is the only client, so
 * no story HAS a style until the creator can set one, and a read side with
 * nothing to read is indistinguishable from a broken one. The same mistake as
 * the profile-view count, whose writer nothing called.
 *
 * ─── THE EIGHT ARE AN ALLOWLIST, NOT A SUGGESTION ───────────────────────────
 * The service takes these exact uppercase hex values and 400s a ninth, so the
 * picker is driven off this list rather than a colour input. Both fields are
 * REQUIRED together when the object is sent — it is all-or-nothing, not a
 * partial — and sending it on anything but a story is a 400 rather than being
 * ignored.
 *
 * ─── THE FONT IS A TOKEN AND THE TYPEFACE IS OURS ───────────────────────────
 * The service stores `sans | serif | display | mono` and says in as many words
 * that which face each one means is the client's decision. So the mapping lives
 * here, once, rather than in whichever component happens to draw a story.
 */

/** The service's own palette, in its own order. A ninth value is a 400. */
export const STORY_BACKGROUNDS = [
  "#7E3BEB",
  "#5B05E6",
  "#1D9BF0",
  "#16A34A",
  "#E84A4A",
  "#F59E0B",
  "#0F766E",
  "#1F1F23",
] as const;

export type StoryBackground = (typeof STORY_BACKGROUNDS)[number];

export const STORY_FONTS = ["sans", "serif", "display", "mono"] as const;
export type StoryFont = (typeof STORY_FONTS)[number];

export interface StoryStyle {
  background: StoryBackground;
  font: StoryFont;
}

/**
 * What this app draws for each token.
 *
 * `display` is the app's own display face (`ws-display`), which is the one
 * genuinely branded choice here — the other three are the generic families a
 * person means when they pick them. Kept as class names rather than raw
 * families so a story is set in the same faces as the rest of the product.
 */
export const STORY_FONT_CLASS: Record<StoryFont, string> = {
  sans: "font-sans",
  serif: "font-serif",
  display: "ws-display",
  mono: "font-mono",
};

/**
 * The background a story PLAYS on, including the one it had before any of this
 * existed.
 *
 * Null is not a gap: the service's own words are that null means "play on the
 * default background, which is how every story posted before this existed". So
 * the violet gradient this app always drew stays the answer for a story with no
 * style, rather than those stories suddenly turning black.
 */
export const STORY_DEFAULT_BACKGROUND =
  "linear-gradient(160deg,#9F65FD 0%,#5B05E6 100%)";

export function storyBackgroundCss(style: StoryStyle | null | undefined): string {
  return style ? style.background : STORY_DEFAULT_BACKGROUND;
}

export function storyFontClass(style: StoryStyle | null | undefined): string {
  return style ? STORY_FONT_CLASS[style.font] : "font-sans";
}

/**
 * Is this value one of the eight?
 *
 * Used where a style arrives from the wire rather than from the picker. A
 * background the service would refuse must not be painted — it would render a
 * story in a colour that cannot be saved, which reads as the picker being
 * broken the next time somebody edits it.
 */
export function isStoryBackground(value: unknown): value is StoryBackground {
  return (
    typeof value === "string" &&
    (STORY_BACKGROUNDS as readonly string[]).includes(value)
  );
}
