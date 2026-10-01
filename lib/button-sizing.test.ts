import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Anti-drift ratchet for the canonical button-size scale (see CLAUDE.md "Buttons").
//
// The scale lives in one place — the ws-btn-{sm,md,lg} / ws-iconbtn-{sm,md,lg}
// size utilities in app/globals.css, consumed by components/ui/button.tsx. A
// button is one colour utility + one size utility + a radius class; nothing
// hand-writes height/padding/font again.
//
// This test scans for the pattern that means "a pressable control still carries
// its own geometry": a className string that contains `ws-press` AND an ad-hoc
// height/padding/size token BUT no ws-btn-*/ws-iconbtn- size utility. `ws-press`
// is the app's universal press-spring, so it is the honest marker of a button.
// (Limitation: a button that omits ws-press escapes this scan — acceptable for a
// drift ratchet; the migration itself catches those visually.)
//
// RATCHET: the count starts at the pre-migration baseline and only ever drops.
// Each migration batch lowers RATCHET_MAX to the new offender count. New ad-hoc
// buttons push the count over the ceiling and fail here — exactly like the
// phantom-route and shell-invariant checks. Target end state: 0.

const ROOTS = ["components", "features"];

// Design-locked or trick-based surfaces that are sanctioned to keep bespoke
// geometry forever — the honest record of exceptions (like BFF_HANDLED). Grow
// this (not the ceiling) when a surface is a genuine, reviewed exception.
const DESIGN_LOCKED = new Set<string>([
  // Figma-measured 78x38, pinned by shell-invariants.test.ts.
  "features/profile/components/follow-pill.tsx",
  // The featured hero's two-slot arena CTA — bespoke min-width/gap, test-pinned.
  "features/feed/components/featured-arena.tsx",
  // Section-header "View more" is a compact secondary action, deliberately one
  // step below the scale's smallest tier (28px, under the 44px touch floor).
  "components/layout/section-heading.tsx",
  // Home's "Coming Soon" card is node 1542:3294 pixel for pixel — the 89-tall
  // cover and the 28-tall Share carry the file's own heights, not the scale.
  "components/layout/coming-soon-card.tsx",
  // The profile's follow row is node 2112:19612 pixel for pixel — 28-tall
  // controls and the 118-wide Following pill carry the file's own heights,
  // not the scale (the same standing as follow-pill.tsx's 78×38).
  "features/profile/components/profile-action-row.tsx",
  // A gist room posted to the feed (2082:20198 / 20246 / 1356:32947). Its
  // three actions are 40 tall in all three states — the card's own geometry,
  // four under the touch floor and four over the scale's smallest desktop
  // tier, so neither `ws-btn-sm` nor `ws-btn-md` is the file's number.
  "features/feed/components/room-post-card.tsx",
  /*
    A house member's tile (1285:36955). Its wink and follow controls are the
    file's own 24px discs, sized to overlap a 104-wide photo — a badge on a
    face, not a button in a row, and widening them to the 44 floor would push
    them off the picture they belong to. WORTH KNOWING RATHER THAN HIDING:
    24 is a little over half the touch floor, so these are the smallest real
    controls in the app. They are also duplicates — the same wink and follow
    live at full size on the person's profile, one tap away through the same
    tile — so nobody is locked out of the action by missing them.
  */
  "components/layout/house-member-tile.tsx",
  // The house banner's 38 overflow trigger and the 48 "View all" disc, both
  // the file's own geometry on a surface built to its pixels.
  "components/layout/house-profile-screen.tsx",
  /*
    The avatar studio's preview card (1863:2412). Its BACK uses the scale —
    `ws-iconbtn-lg` is exactly the file's 48 — but the close disc on the card
    is the file's own 44.118, a constant the scale cannot express: every
    `ws-iconbtn-*` tier shrinks to 32..36 on a fine pointer, and this one is
    drawn at one size over a 580x440 picture whatever is pointing at it.

    WORTH KNOWING RATHER THAN HIDING: at 44.118 it clears the touch floor, and
    it is not a lone route out — the studio is built on `Sheet`, so Escape and
    the backdrop close it too, and the header's Back does the same job.
  */
  "features/profile/components/avatar-studio-screen.tsx",
  /*
    Buy-a-gift (1285:83137). Its ACTION uses the scale — `ws-btn-lg` is
    exactly the node's 48 at 16px — but the dialog's three other controls sit
    below the scale's smallest tier on purpose: a 43 round close, and 32
    chevrons that float ON the artwork at its vertical centre. Widening those
    to the 44 floor would push the chevrons off the picture they belong to and
    make the close heavier than the title beside it.

    WORTH KNOWING RATHER THAN HIDING: 32 is under the touch floor. Neither is
    a lone route to anything — the dialog closes on backdrop and Escape (it is
    built on `Sheet`), and the chevrons only walk a catalogue the grid behind
    them already lists in full, one tap away.
  */
]);

// Lower this as batches migrate. Target: 0. Raise ONLY by adding to
// DESIGN_LOCKED.
//
// 57 → 55 when the scan stopped reading COMMENTS (see stripComments below).
// Two of the old count were never real: a quote in a comment swallowed the
// markup after it, and a control with no geometry of its own was charged for
// an `h-10` two hundred lines away. The number only means something if every
// entry in it is a real offender.
//
// 55 → 56 for `media-send-bar.tsx`, which arrived on staging with its own
// h-10 / h-12 discs. That one is REAL — it is a control carrying its own
// geometry — and it is raised rather than migrated because the bar's sizes
// were being iterated on with ogazboiz the same day, and quietly resizing
// somebody's in-flight design to satisfy a ratchet is how the ratchet becomes
// the thing people route around. Migrate it with the next batch.
const RATCHET_MAX = 56;

const STRING_RE = /"([^"\\]*ws-press[^"\\]*)"|`([^`\\]*ws-press[^`\\]*)`/g;

/**
 * COMMENTS ARE NOT CODE, and scanning them made this check lie.
 *
 * The scan pairs quotes and backticks naively. A quote inside a comment — an
 * apostrophe, a quoted class name, a template literal in prose — opens a span
 * that runs to the next one, swallowing whatever markup sits between them. A
 * control with no geometry of its own then reads as an offender because some
 * OTHER element's `h-10` fell inside the swallowed range.
 *
 * That is not hypothetical: adding a reply control to the room chat tripped
 * the ratchet three times running, each time on a comment two hundred lines
 * away, and each "fix" moved the false positive somewhere else. Stripping
 * comments first makes the check answer the question it means to ask.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
// A hard-coded button HEIGHT or square DIAMETER is the honest signal that a
// control carries its own geometry. `py-*` is deliberately excluded: list rows
// and cards legitimately carry vertical padding (CLAUDE.md "List rows carry
// their own py-3"), so flagging it would train everyone to ignore the check.
const ADHOC =
  /\b(h-(7|8|9|10|11|12|14)|h-\[[0-9.]+px\]|size-(6|7|8|9|10|11|12|14)|size-\[[0-9.]+px\])\b/;
const SIZE_UTIL = /\bws-(btn|iconbtn)-(sm|md|lg)\b/;

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

function offenders(): string[] {
  const files = ROOTS.flatMap((r) => walk(r, []));
  const hits: string[] = [];
  for (const f of files) {
    if (DESIGN_LOCKED.has(f)) continue;
    const text = stripComments(readFileSync(f, "utf8"));
    for (const m of text.matchAll(STRING_RE)) {
      const cls = m[1] ?? m[2];
      if (ADHOC.test(cls) && !SIZE_UTIL.test(cls)) {
        hits.push(f);
        break;
      }
    }
  }
  return hits.sort();
}

test("no NEW button carries ad-hoc sizing (ratchet only tightens)", () => {
  const found = offenders();
  assert.ok(
    found.length <= RATCHET_MAX,
    `Ad-hoc button sizing rose to ${found.length} (ceiling ${RATCHET_MAX}). ` +
      `Use the ws-btn-{sm,md,lg} / ws-iconbtn-{sm,md,lg} size utilities. New/changed offenders:\n` +
      found.join("\n")
  );
});
