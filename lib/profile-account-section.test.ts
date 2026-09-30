import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * THE ACCOUNT SECTION IS YOUR OWN PROFILE'S, AND NOBODY ELSE'S.
 *
 * The strip is Earnings / Badges / Gift Gallery / Replays, and every one of
 * those is a `/me` question: there is no route that answers what somebody else
 * was paid, what badges they hold, or what gifts they were sent. Rendered on a
 * visitor's view it would either be empty or — far worse — answer with the
 * VIEWER's own figures under the profile owner's name.
 *
 * Source-level, because the section is behind an id comparison against a
 * client hook: server-rendered HTML never contains it, so no request can prove
 * its absence. What can be proved without a browser is that the gate exists,
 * that the gallery cannot be mounted with a fabricated ownership claim, and
 * that the one query it makes is the `/me` route it says it is.
 */
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const page = stripComments(read("features/profile/components/profile-page.tsx"));
const screen = stripComments(read("components/layout/profile-screen.tsx"));

describe("the profile's account section is own-profile only", () => {
  it("mounts the account strip behind the ownership check", () => {
    /*
      The gate used to read `giftGallerySlot`, which was doing two jobs:
      mounting the gallery, and standing in for "the account panels exist".
      Removing the Gift Gallery would have taken Earnings, Badges and Replays
      with it, so the gate moved to the other own-profile slot rather than
      being deleted with the tab.
    */
    assert.match(
      page,
      /\{isMe && earningsSlot && \(/,
      "the account strip lost its own-profile gate — it would render on strangers"
    );
  });

  it("derives ownership by COMPARING ids, never assuming", () => {
    // The backend has no isMe flag, so this is the only thing that can decide.
    assert.match(page, /profile\.data\.id === me\.data\.id/);
  });

  /*
    REMOVED WITH THE GIFT GALLERY. It pinned that the gallery took no `isMe`
    prop, because an earlier version did and the call site passed a hardcoded
    `true` — which would have printed the VIEWER's gift counts under somebody
    else's name the moment the slot moved out of the gate.

    The rule survives in the assertion above and in "derives ownership by
    COMPARING ids": ownership is decided by the page, from `useMe`, and is
    never a prop a caller can assert. There is simply no gallery to point at
    any more, and a test that reads a deleted file is not a test.
  */

  it("never ships a tab that HAS a panel as disabled", () => {
    /*
      THE BUG THIS EXISTS FOR. Earnings was left with a `disabledReason` after
      its panel was built, so it rendered first (it is the default), looked
      fine, and the moment you switched to Gift Gallery you could not get back
      — the button was genuinely `disabled`. It survived typecheck, lint, 974
      tests and a build, because nothing in any of those knows that a tab with
      a panel behind it must be reachable.

      The rule is the one the flagged-capability convention already implies:
      `disabled` means "there is nothing behind this", so a tab the page
      renders a panel for may never carry it.
    */
    /*
      A LITERAL reason is the bug; a COMPUTED one is the rule working. Badges
      has a panel (543:40148) and a tab whose reason is an expression that
      resolves to `undefined` the moment `GET /profiles/:username/badges`
      answers — the panel is mounted on the same data the tab keys off, so the
      two can never disagree. What this test forbids is a reason written as a
      string beside a panel that always renders, which is what Earnings had.
    */
    const panelled = [...page.matchAll(/accountTab === "(\w+)" &&/g)].map((m) => m[1]);
    assert.ok(panelled.length >= 2, "expected the earnings and gifts panels to be found");
    for (const tab of panelled) {
      const entry = page.match(new RegExp(`\\{[^{}]*value: "${tab}"[^{}]*\\}`));
      assert.ok(entry, `no tab entry found for the "${tab}" panel`);
      assert.doesNotMatch(
        entry[0],
        /disabledReason:\s*"/,
        `"${tab}" renders a panel but its tab is disabled — it cannot be reached`
      );
    }
  });

  /*
    THE GALLERY'S OWN RULES WENT WITH IT — reading only the caller's own tips,
    counting only CONFIRMED ones, and showing no number for a gift nobody has
    sent rather than a zero.

    Two of the three are not lost: "only confirmed tips are counted" is the
    service's own rule and is pinned where money is actually rendered
    (`lib/format.test.ts`, and the Earnings panel's own tests), and "absent
    rather than zero" is pinned on the balance chip and the house member line.
    The third — counting received tips by `giftId` — had no other surface and
    goes with the feature.
  */
});
