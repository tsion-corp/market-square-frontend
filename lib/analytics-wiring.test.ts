import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

/*
  THE EVENTS THE PRODUCT IS ABOUT, AND WHETHER ANYTHING ACTUALLY SENDS THEM.

  `lib/analytics.ts` opens with a note saying this exact problem was found and
  corrected: eleven of the original eighteen events were streams, tickets and
  store, on a product whose niche is rooms and conversation, so "what do people
  do here" could only ever have answered with what happened to be instrumented.

  The correction added the community names to the type union AND NEVER WROTE A
  SINGLE CALL SITE. Fifteen names sat in that union, fully typed, and no code
  path could produce any of them. The fix lived entirely in a list of strings,
  which is why nothing failed and nobody noticed — a name with no caller is
  indistinguishable from a feature nobody uses.

  So these assert the CALL SITES, not the vocabulary. A name in the union is
  evidence of intent; a call site is evidence of measurement.

  See `room-guests.test.ts` for why the URL goes to readFileSync whole.
*/

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Every file that may legitimately fire an event. */
const SOURCES = [
  "features/feed/hooks/use-feed.ts",
  "features/feed/hooks/use-comments.ts",
  "features/messages/hooks/use-messages.ts",
  "features/profile/hooks/use-profile.ts",
  "features/streams/hooks/use-streams.ts",
  "features/tips/hooks/use-tips.ts",
].map(read).join("\n");

const analytics = read("lib/analytics.ts");
const mixpanel = read("lib/mixpanel.ts");

describe("the acts this product is for are measured", () => {
  /*
    One per thing a person actually DOES here. If one of these fails, the number
    it feeds does not become wrong — it stops existing, silently, which is the
    failure mode that produced this test.
  */
  for (const event of [
    "post_created",
    "post_liked",
    "comment_created",
    "message_sent",
    "wink_sent",
    "gift_sent",
    "room_opened",
  ]) {
    it(`${event} has a call site`, () => {
      assert.ok(
        SOURCES.includes(`"${event}"`),
        `${event} is in the vocabulary and nothing sends it — the exact state this file exists to prevent`
      );
    });
  }
});

describe("what is deliberately NOT sent from the browser", () => {
  it("does not fire room_joined or room_left", () => {
    /*
      The SERVER records those, which is why they were the only two events in
      the analyst's data — they are the only ones that do not depend on a
      browser reaching anything. Firing them here would double-count every one.

      `room_left` is also a trap in the other direction: it means a PERSON left,
      not a host closing the room for everybody. Two facts under one name is
      worse than a missing name, because the number looks plausible and answers
      a question nobody asked.
    */
    assert.ok(!SOURCES.includes('"room_joined"'), "joins are recorded server-side");
    assert.ok(!SOURCES.includes('"room_left"'), "leaves are recorded server-side");
  });

  it("counts a like but not an unlike", () => {
    // An undo is not an engagement. Counting both makes a post somebody
    // double-tapped and took back look busier than one they meant.
    const feed = read("features/feed/hooks/use-feed.ts");
    const atLike = feed.slice(feed.indexOf('"post_liked"') - 400, feed.indexOf('"post_liked"'));
    assert.match(atLike, /if \(like\)/u, "the like event must be behind a `like` check");
  });

  it("never puts message content in a payload", () => {
    /*
      Analytics must not become a copy of what people say to each other. The
      message event carries whether there was media and whether it was a reply,
      and nothing a person wrote.
    */
    const messages = read("features/messages/hooks/use-messages.ts");
    const at = messages.indexOf('"message_sent"');
    const payload = messages.slice(at, at + 500);
    assert.ok(!/\btext\b/u.test(payload), "no message text may reach an analytics payload");
  });
});

describe("the transport", () => {
  it("sends from our OWN origin by default, not api.mixpanel.com", () => {
    /*
      THE WHOLE REASON THE DATA WAS EMPTY. `api.mixpanel.com` is on the block
      list of most mobile ad-blockers and privacy browsers, and ingest is
      fire-and-forget, so a blocked send is indistinguishable from one that
      worked. Measured, the product looked like a place where people arrived and
      did nothing.

      First-party is the DEFAULT and not an opt-in, because a fix that must be
      remembered in an env var is a fix that is off in the environment nobody
      checked — which is where this one was, for the whole life of the feature.
    */
    assert.match(mixpanel, /const INGEST = PROXY \|\| api\("\/api\/mx"\)/u);
  });

  it("latches on 404 only, never on a service having a bad minute", () => {
    /*
      404 is "no collector is deployed here" — a fact about the deployment that
      will not change under the reader's feet. A 429 or a 5xx is temporary, and
      latching on those turns a bad minute into a session that reports nothing,
      which is exactly when the events were still worth keeping.
    */
    assert.match(analytics, /if \(response\.status === 404\) collectorMissing = true/u);
    assert.ok(
      !/status >= 400|status !== 200|!response\.ok/u.test(analytics),
      "only a 404 may stop the session reporting"
    );
  });

  it("sends the batch envelope the collector takes", () => {
    // `{ events: [...] }` from the start rather than added later: a shape that
    // changes is a deploy where one side is still speaking the old one.
    assert.match(analytics, /JSON\.stringify\(\{ events: \[\{ \.\.\.payload, occurredAt/u);
  });
});
