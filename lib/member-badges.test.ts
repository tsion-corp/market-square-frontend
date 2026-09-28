import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/**
 * A GROUP'S MEMBER LIST SAYS WHO SOMEBODY IS, THEN WHAT THEY ARE HERE.
 *
 * ogazboiz: "show each person name and if the person is an admin ... it will
 * show next to the person like a badge ... and if the person is verified it
 * will show with the person name".
 *
 * The row already knew the role and drew it as an uppercase word pinned to the
 * row's RIGHT EDGE — a column away from the person it described on any long
 * name, which reads as a table heading rather than a badge. And it never drew
 * the verified check at all.
 */
describe("a group member row", () => {
  const thread = read("features/messages/components/thread.tsx");
  const badge = read("components/ui/badge.tsx");

  it("puts the check and the role WITH the name, not at the far edge", () => {
    assert.match(thread, /<VerifiedBadge\s+verification=\{profile\.verification\}/u);
    assert.match(thread, /<MemberRoleChip role=\{member\.role\} \/>/u);
    // The old right-edge labels are gone — they were the thing being fixed.
    assert.doesNotMatch(
      thread,
      /uppercase tracking-wide text-create">Owner</u,
      "the role is pinned to the row's edge again"
    );
  });

  it("truncates the NAME and never the badges", () => {
    /*
      An ellipsis on a name still names somebody. Half a check, or a clipped
      "Admin", says something false — so the badges are `shrink-0` and the name
      is what gives way.
    */
    assert.match(thread, /className="h-3\.5 w-3\.5 shrink-0"/u);
    assert.match(badge, /"inline-flex shrink-0 items-center rounded-\[21px\]/u);
  });

  it("keeps a MEMBERSHIP role separate from a PLATFORM role", () => {
    /*
      `RoleChip` draws Ambassador and WorldStreet — true of the person on every
      screen. `MemberRoleChip` draws Owner and Admin — true only in this group,
      since the same person is an ordinary member of the next one. Folding
      owner/admin into `ROLE_LABEL` would make a chip claim to be about the
      person when it is only about this room.
    */
    assert.match(badge, /export function MemberRoleChip/u);
    assert.match(badge, /export function RoleChip\(\{ role, className \}/u);
    assert.doesNotMatch(badge, /ROLE_LABEL: Record<string, string \| null> = \{[\s\S]{0,400}owner:/u);
  });

  it("draws nothing for a plain member, or for a role it has not heard of", () => {
    // A column repeating "Member" is noise that hides the two rows that
    // matter. And an unknown role gets no invented label.
    const chip = badge.slice(badge.indexOf("export function MemberRoleChip"));
    assert.match(chip, /return null;/u);
    assert.doesNotMatch(chip, /Member</u, "every row now carries a chip");
  });

  it("uses the app's one chip shape, so a group role is not a new species", () => {
    // Owner tints the shared shell rather than replacing it; admin is the
    // shell untouched.
    const chip = badge.slice(badge.indexOf("export function MemberRoleChip"));
    assert.match(chip, /<ChipShell className="border-create\/40 bg-create\/15 text-create">Owner<\/ChipShell>/u);
    assert.match(chip, /<ChipShell>Admin<\/ChipShell>/u);
  });
});

/**
 * A GROUP MESSAGE SAYS WHO SAID IT.
 *
 * ogazboiz, pointing at Telegram: "i can see name and the role this is what i
 * am saying". A group showed a FACE and never a NAME, so telling two people
 * apart meant recognising their avatar — and an admin speaking for the house
 * read exactly like anybody else talking.
 */
describe("a group run's sender line", () => {
  const thread = read("features/messages/components/thread.tsx");

  it("names the sender, with their check and their role", () => {
    // INSIDE the bubble now (ogazboiz, 2026-09-28: the name above the run sat
    // "far from the sent message") — the header rides the bubbles' top slot.
    assert.match(thread, /\{sender\?\.displayName \?\? nameOf\(message\.senderId\)\}/u);
    assert.match(thread, /verification=\{sender\.verification\}/u);
    assert.match(thread, /\{senderRole \? <MemberRoleChip role=\{senderRole\} \/> : null\}/u);
  });

  it("rides the bubble's own top slot, never wrapping a bubble", () => {
    /*
      THIS IS THE WHOLE BUG, TWICE OVER. A bubble is capped at
      `max-w-[min(85%,480px)]`, and 85% resolves against ITS PARENT. Wrapping a
      bubble in a column to stack a name on top made that parent the column,
      which is shrink-to-fit — so the cap became 85% of the NAME's width.
      "okay" rendered as three stacked letters under a short name and correctly
      under a long one, which is why it looked like a text bug rather than a
      layout one.

      Inside the bubble (the quote slot), the bubble stays a direct child of
      its row and the percentage means what it always meant.
    */
    assert.doesNotMatch(
      thread,
      /flex (min-w-0 )?flex-col items-start gap-1">\s*<span className="flex max-w/u,
      "the name wraps the bubble again — the 85% cap will resolve against it"
    );
    // The row renders the bubble directly, with nothing between.
    assert.match(thread, /\n      \{content\}\n/u);
  });

  it("draws once per run, and never for your own messages", () => {
    // The first bubble of a run carries the name; a run is consecutive
    // messages from one sender, so first-of-run is once per name. Your own
    // messages and a 1:1's never carry one.
    assert.match(thread, /showSender=\{index === 0\}/u);
    assert.match(thread, /group && !mine && showSender \? \(/u);
  });

  it("reads the role off the SAME roster the faces come from", () => {
    // A bubble and the members sheet must never disagree about who runs the
    // place, so there is one source rather than two lookups.
    assert.match(thread, /members\.data\?\.items\.find\(\(row\) => row\.profile\?\.id === senderId\)\?\.role \?\? null/u);
  });
});
