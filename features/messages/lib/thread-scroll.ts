/**
 * When the thread should follow new messages.
 *
 * A chat pane lands on the newest message and stays there as more arrive — but
 * only while the reader is already at the live edge. Someone scrolled up
 * reading yesterday must not be yanked to the bottom because a message landed,
 * so "stick to the bottom" is a piece of state that the reader's own scrolling
 * turns off and back on.
 *
 * The measurement is pure and lives here so it can be tested without a DOM.
 */

/** How far from the bottom still counts as being at the bottom.
    A reader is never pixel-exact, and sub-pixel rounding on a zoomed or
    fractional-DPI display leaves a pixel or two behind even when scrolled all
    the way down — a zero threshold would drop out of follow mode on its own. */
export const STICK_THRESHOLD = 80;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Is the reader at (or close enough to) the live edge?
 *
 * True when the content does not overflow at all: a thread shorter than its
 * pane has no "up" to be scrolled to, so it is always at the bottom and always
 * follows.
 */
export function isAtBottom(
  { scrollTop, scrollHeight, clientHeight }: ScrollMetrics,
  threshold: number = STICK_THRESHOLD
): boolean {
  const distance = scrollHeight - clientHeight - scrollTop;
  // Not `distance <= threshold` alone: over-scroll bounce on iOS reports a
  // NEGATIVE distance, which is still the bottom.
  return distance <= threshold;
}

/**
 * ─── OLDER MESSAGES ─────────────────────────────────────────────────────────
 *
 * The thread opened on its newest fifty and stopped there: the service pages
 * older history by cursor, but nothing ever asked for the next page, so a
 * reader who scrolled up looking for last week found the river simply ended
 * (a member of a group, 2026-09-25, "all the posts I made in my group the last
 * few weeks I can't scroll up to find"). The newest page keeps polling as it
 * did; older pages are a second, separate query that the reader's scroll
 * drives, and these three rules are what the thread needs from it.
 */

/** How close to the top counts as "asking for older". Well before the edge,
    so the next page is there before the reader arrives, like the feed's
    600px sentinel margin. */
export const NEAR_TOP_THRESHOLD = 400;

export function isNearTop({ scrollTop }: Pick<ScrollMetrics, "scrollTop">, threshold = NEAR_TOP_THRESHOLD): boolean {
  return scrollTop <= threshold;
}

/**
 * Where the scroll must sit after older messages were PREPENDED, so the
 * message the reader was looking at stays exactly where it was. Content grew
 * above the viewport by the difference in scroll height; the offset moves by
 * the same amount.
 */
export function anchorAfterPrepend(
  before: Pick<ScrollMetrics, "scrollTop" | "scrollHeight">,
  scrollHeightAfter: number
): number {
  return before.scrollTop + (scrollHeightAfter - before.scrollHeight);
}

/**
 * The river, oldest first: every older page (each newest-first, fetched
 * top-down through history), then the live newest page. Pages overlap when
 * new messages arrive between fetches and shift the newest page's cursor, so
 * a message is kept once, at its first (oldest) position.
 */
export function mergeHistory<T extends { id: string }>(
  newestPage: readonly T[],
  olderPages: readonly (readonly T[])[]
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  // Oldest page last in the list; walk from the oldest fetched page forward.
  const ordered = [...olderPages].reverse();
  for (const page of [...ordered, newestPage]) {
    for (const message of [...page].reverse()) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      out.push(message);
    }
  }
  return out;
}
