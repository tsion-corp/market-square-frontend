import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { pushPromptKey, pushPromptState } from "./push-prompt.ts";
import type { PushAvailability } from "./push.ts";

/*
  THE ASK HAS TO REACH PEOPLE WHO NEVER OPEN SETTINGS.

  Push has worked for weeks and almost nobody has it on, because the only place
  it was ever offered is a row inside Settings → Notifications. These pin the
  decision about when to offer it somewhere they will actually see.

  See `room-guests.test.ts` for why the URL goes to readFileSync whole.
*/

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const base = { enabled: false, dismissed: false };

describe("when the card appears", () => {
  it("asks on a browser that can be asked", () => {
    assert.equal(pushPromptState({ ...base, availability: "ready" }), "ask");
  });

  it("gives an iPhone in a tab the install step INSTEAD of a button", () => {
    /*
      The button cannot work there — iOS delivers web push to a Home Screen app
      and never to a Safari tab — so offering one would be a control that does
      nothing, on the one platform where the reader is two taps from it working.
    */
    assert.equal(pushPromptState({ ...base, availability: "needs-install" }), "install");
  });
});

describe("when it stays out of the way", () => {
  it("never offers to turn on what is already on", () => {
    assert.equal(pushPromptState({ ...base, availability: "ready", enabled: true }), "hidden");
    // Including on iOS, where "installed and already subscribed" is the whole
    // point of having shown the install card earlier.
    assert.equal(
      pushPromptState({ ...base, availability: "needs-install", enabled: true }),
      "hidden"
    );
  });

  it("stays dismissed", () => {
    assert.equal(pushPromptState({ ...base, availability: "ready", dismissed: true }), "hidden");
    assert.equal(
      pushPromptState({ ...base, availability: "needs-install", dismissed: true }),
      "hidden"
    );
  });

  it("says nothing in any state the reader cannot act on from the card", () => {
    /*
      `blocked` is the deliberate one. The remedy is several taps into browser
      settings, Settings already carries that sentence, and a card that comes
      back to say "you have blocked us" is a nag rather than an offer.
    */
    const quiet: PushAvailability[] = ["unsupported", "unavailable", "blocked", "loading"];
    for (const availability of quiet) {
      assert.equal(
        pushPromptState({ ...base, availability }),
        "hidden",
        `${availability} must not render a card`
      );
    }
  });

  it("covers every availability the settings row can produce", () => {
    /*
      A new `PushAvailability` must be a deliberate decision here rather than
      falling through to silence unnoticed — the enum is the one in `push.ts`,
      read from source so adding a state to it fails THIS test rather than
      quietly skipping the reader.
    */
    const declared = read("lib/push.ts")
      .slice(0, read("lib/push.ts").indexOf("/**", 200))
      .match(/\| "([a-z-]+)"/gu)
      ?.map((line) => line.replace(/\| "|"/gu, ""));
    assert.deepEqual(
      declared,
      ["unsupported", "needs-install", "unavailable", "blocked", "loading", "ready"],
      "PushAvailability changed — decide what the prompt does with the new state"
    );
  });
});

describe("the card is actually mounted", () => {
  /*
    THE DECISION ABOVE IS WORTH NOTHING IF NOTHING RENDERS IT, and a component
    that exists but is never composed in is the failure this codebase keeps
    hitting — a written side with no reader. So the wiring is pinned too, end to
    end, rather than left to "I added it".
  */
  it("reaches the notifications list through a slot", () => {
    const screen = read("components/layout/notifications-screen.tsx");
    assert.match(screen, /promptSlot=\{<PushPrompt \/>\}/u, "the screen must pass the card in");
    assert.match(screen, /import \{ PushPrompt \}/u);

    const page = read("features/notifications/components/notifications-page.tsx");
    assert.match(page, /\{promptSlot && <div className="px-8 pb-2">\{promptSlot\}<\/div>\}/u, "the list must render the slot it accepts");
  });

  it("is composed in the LAYOUT, not inside the notifications slice", () => {
    /*
      The switch belongs to the settings slice and the list to notifications;
      slices never import each other, so `components/layout` is the only place
      the two may meet — the same rule `actionSlot` follows for the profile
      slice's Wink back and Follow back.
    */
    const page = read("features/notifications/components/notifications-page.tsx");
    assert.ok(
      !page.includes("@/features/settings"),
      "the notifications slice must not import settings — compose it in components/layout"
    );
  });

  it("offers the switch itself, rather than linking off to Settings", () => {
    // A card that sends the reader to Settings to find a row is the dead end
    // this exists to remove: the ask and the switch are the same control.
    const card = read("components/layout/push-prompt.tsx");
    assert.match(card, /push\.onChange\(true\)/u);
  });
});

describe("remembering a dismissal", () => {
  it("keeps the two asks apart", () => {
    /*
      An iPhone reader meets both in order: "add it to your Home Screen" in the
      tab, then "turn these on" inside the installed app. One shared key would
      let the first dismissal answer the second question, so the reader who
      followed our instructions exactly is the one never offered the switch.
    */
    assert.notEqual(pushPromptKey("ask"), pushPromptKey("install"));
  });
});
