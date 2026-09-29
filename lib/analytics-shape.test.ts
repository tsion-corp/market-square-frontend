import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync("lib/analytics.ts", "utf8");

/*
  WHAT EVERY EVENT CARRIES — set once, attached to all.

  Read as source because `trackMarketEvent` needs a browser, a session and a
  collector to run. What regresses here is the SHAPE, and the shape is what is
  pinned: a property quietly dropped, or a user id quietly added.
*/
describe("the common properties every event carries", () => {
  it("are built in one place, not spelled per call site", () => {
    assert.match(source, /function commonProperties\(surface: string\)/);
    assert.match(source, /\.\.\.commonProperties\(input\.surface\)/);
  });

  for (const field of ["version", "sessionId", "timestamp", "signedIn", "zone", "viewport"]) {
    it(`carries ${field}`, () => {
      assert.match(source, new RegExp(`\\b${field}:`), `${field} must ride on every event`);
    });
  }

  /*
    THE ONE THAT MUST NOT BE ADDED. An id the browser asserts is a claim, and a
    forged one on an analytics table is worse than a missing one: a gap is
    visible, a forgery is indistinguishable from truth and poisons every query
    built on it. The viewer is attached SERVER-SIDE from the session the BFF
    already forwards.
  */
  /*
    THE RULE, AND WHY ITS SCOPE IS WHAT IT IS.

    No user id goes in the EVENT PAYLOAD, because the payload is what a
    collector of ours would receive — and that collector holds the session, so
    it is better placed to say who the viewer is than a browser that can claim
    anything.

    Mixpanel is a departure and a deliberate one: there is no server of ours in
    that path, so the choice is a claimed `distinct_id` or no per-person
    analysis at all — and "what does a user do most" is the question that was
    asked. It is set in `lib/mixpanel.ts`, out of the payload, where the
    departure is visible and documented rather than smuggled into a field
    called `userId`.

    That keeps this assertion meaningful: the day our collector exists, the
    payload is still clean and the service attaches the viewer itself.
  */
  it("never puts a user id in the event payload", () => {
    for (const forbidden of [/\buserId:/, /\bprofileId:/, /\bviewerId:/]) {
      assert.doesNotMatch(source, forbidden, "the viewer is the service's to attach, not the browser's to claim");
    }
  });

  /*
    A WINDOW WIDTH IS NOT A DEVICE. It was `device`, from
    `matchMedia("(max-width: 767px)")`, so a narrowed desktop recorded as
    "mobile". A lie under that column name gets believed and re-quoted.
  */
  it("calls a viewport a viewport", () => {
    assert.match(source, /viewport: window\.matchMedia\("\(max-width: 767px\)"\)\.matches \? "narrow" : "wide"/);
    assert.doesNotMatch(source, /\n\s*device:/, "`device` is a lie that outlives the rename");
  });

  /*
    `from` is the surface BEFORE this one, which is the whole of a funnel. It
    must be read before the current surface overwrites it, or every event
    reports itself as its own predecessor.
  */
  it("records the previous surface, and records it before overwriting", () => {
    assert.match(source, /lastSurface !== null && lastSurface !== surface \? \{ from: lastSurface \}/);
    const emit = source.slice(source.indexOf("export function trackMarketEvent"));
    assert.ok(
      emit.indexOf("...commonProperties(") < emit.indexOf("lastSurface = input.surface"),
      "the payload must be built before the surface is remembered",
    );
  });

  /*
    A COMMON SHAPE IS A CLAIM THAT EVERY EVENT HAS THIS. `accessType` is
    ticket-specific: seventeen of the eighteen kinds declared a field they
    never set.
  */
  it("keeps ticket-specific fields out of the shape all events carry", () => {
    const input = source.slice(source.indexOf("interface MarketEventInput"));
    const body = input.slice(0, input.indexOf("}"));
    assert.doesNotMatch(body, /accessType\?:/, "it belongs in metadata, where it is obviously optional");
  });
});

/*
  WHAT IS MEASURED DECIDES WHAT CAN BE LEARNED. Eleven of the original
  eighteen events were streams, tickets and store, on a product whose niche is
  rooms and conversation — so "what do users do most" had a predetermined
  answer. These are the actions that were measured nowhere.
*/
describe("the events cover what this product is actually for", () => {
  for (const name of [
    "post_created",
    "comment_created",
    "gift_sent",
    "room_opened",
    "room_joined",
    "message_sent",
    "wink_sent",
  ]) {
    it(`measures ${name}`, () => {
      assert.match(source, new RegExp(`\\| "${name}"`));
    });
  }

  it("keeps the stream and store events rather than trading one blind spot for another", () => {
    for (const kept of ["stream_started", "ticket_purchased", "store_item_viewed"]) {
      assert.match(source, new RegExp(`\\| "${kept}"`));
    }
  });
});

/*
  THE TRANSPORT THAT ACTUALLY EXISTS. `POST /analytics/events` is still not
  deployed, so until it is, Mixpanel is the only thing that receives anything.
*/
describe("the Mixpanel transport", () => {
  const mp = readFileSync("lib/mixpanel.ts", "utf8");

  it("is a no-op without a token, rather than throwing on every event", () => {
    assert.match(mp, /export function mixpanelReady\(\): boolean/);
    assert.match(mp, /return TOKEN\.length > 0;/);
    assert.match(mp, /if \(!TOKEN \|\| typeof window === "undefined"\) return;/);
  });

  /*
    A retried or double-fired event must count ONCE. Without an insert id a
    flaky connection inflates every number it touches, and inflation is the one
    error nobody goes looking for.
  */
  it("de-duplicates with an insert id", () => {
    assert.match(mp, /\$insert_id:/);
  });

  /*
    On a shared device the next person's events must not be filed under the
    last one's, so identity is resettable rather than write-once.
  */
  it("can be reset to nobody", () => {
    assert.match(mp, /export function identifyForAnalytics\(id: string \| null\)/);
    assert.match(mp, /distinct_id: distinctId \?\? sessionId/);
  });

  it("never lets a blocked request reach the caller", () => {
    assert.match(mp, /\.catch\(\(\) => \{\}\)/);
    assert.match(mp, /\} catch \{/, "an ad-blocker can make fetch throw synchronously");
  });

  /*
    The API SECRET is a different credential from the project token and must
    never reach the browser.
  */
  it("reads only the public project token", () => {
    assert.match(mp, /NEXT_PUBLIC_MIXPANEL_TOKEN/);
    assert.doesNotMatch(mp, /API_SECRET|api_secret/);
  });
});
