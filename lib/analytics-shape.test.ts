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
  it("never sends a user id from the client", () => {
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
