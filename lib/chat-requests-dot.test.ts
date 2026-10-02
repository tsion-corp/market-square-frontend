import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

/*
  A WAITING REQUEST IS ANNOUNCED, AND A STRANGER STILL CANNOT COUNT.

  `chatRequests` on `GET /me/unread` counts two things: a stranger's first DM,
  and a HOUSE SEAT somebody added you to without permission to do it silently.
  The service has returned it for weeks and nothing read it — so a pending seat
  landed in a tab with no indication anywhere in the app that it had, which from
  the reader's side is indistinguishable from being put in a house without being
  asked. That is the complaint the whole consent feature answers, and the badge
  is the half that makes it visible.

  The constraint that shapes it: it must NOT be added into the message badge.
  The service keeps the two counts apart precisely so a stranger cannot put a
  NUMBER on somebody's nav, and summing them here would hand that lever to
  anybody who can add you to a house. So it is a DOT — "there is something for
  you", and nothing more.

  See `room-guests.test.ts` for why the URL goes to readFileSync whole.
*/

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const unread = read("hooks/use-unread.ts");
const shell = read("components/layout/app-shell.tsx");
const dock = read("components/layout/bottom-dock.tsx");

describe("the chat-requests dot", () => {
  it("is parsed at all — it was returned and read by nothing", () => {
    assert.match(unread, /chatRequests: z\.number\(\)\.optional\(\)\.default\(0\)/u);
  });

  it("is never summed into the unread badge", () => {
    /*
      The whole reason the service keeps them apart. If this test fails because
      somebody wrote `messages + chatRequests`, the bug is not cosmetic: it lets
      a stranger drive a number on a person who has not agreed to hear from them.
    */
    for (const [name, source] of [
      ["sidebar", shell],
      ["dock", dock],
    ] as const) {
      assert.ok(
        !/messages[^\n]*\+[^\n]*chatRequests|chatRequests[^\n]*\+[^\n]*messages/u.test(source),
        `${name}: a request may never be added into the message count`
      );
    }
  });

  it("shows on both navigations, not just the desktop one", () => {
    // A phone is where most people will meet a house invitation.
    assert.match(shell, /const DOT_FOR: Record</u, "the sidebar needs its own map");
    assert.match(shell, /"\/messages": \(counts\) => \(counts\?\.chatRequests \?\? 0\) > 0/u);
    assert.match(dock, /dot: \(unread\.data\?\.chatRequests \?\? 0\) > 0/u);
  });

  it("never draws a dot and a count on one glyph", () => {
    // Two marks on a 24px icon is noise, not two pieces of news. The count
    // already draws the eye, so it wins and the dot stands down.
    assert.match(shell, /\{badge === 0 && dot && \(/u);
    assert.match(dock, /\{!\(typeof item\.badge === "number" && item\.badge > 0\) && item\.dot && \(/u);
  });

  it("says something to a screen reader, since the mark is aria-hidden", () => {
    /*
      "requests waiting", never a number — the dot carries none, and inventing
      one in the label would make the same promise the badge deliberately does
      not. The dock matters more than it looks: only the ACTIVE dock item is
      labelled visually, so an inactive glyph has no accessible name at all
      without this.
    */
    assert.ok(shell.includes("requests waiting"), "the sidebar link must say it");
    assert.ok(dock.includes("requests waiting"), "the dock link must say it");
    assert.match(dock, /aria-label=\{/u, "the dock item needs a name of its own");
  });
});
