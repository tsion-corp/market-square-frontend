import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

/*
  A PRIVATE ROOM IS PRIVATE TO SOMEBODY, AND WHO DEPENDS ON WHERE IT WAS OPENED.

  Private used to mean one thing: private to the house the room was opened from.
  `guests` on `POST /streams` added a second meaning — private to a list of
  people chosen before the room exists — and the two must never both apply to
  one room. The service refuses the pair outright, because a room with a house
  AND a guest list has two answers to "who is allowed in", and two answers is
  how they come to disagree.

  These read the source rather than render it: the rule is a handful of
  conditions spread across a form, and what matters is that they stay in
  agreement with each other, which is exactly what a later edit breaks silently.

  NOTE the URL form. `new URL("..", import.meta.url).pathname` keeps a directory
  name's space as `%20` and `readFileSync` then cannot open it — eleven test
  files in this repo fail that way on any checkout whose path contains a space.
  Handing the URL object straight to `readFileSync` is the form that works.
*/

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const sheet = read("features/houses/components/open-house-sheet.tsx");
const api = read("features/streams/lib/api.ts");

describe("a private room's guest list", () => {
  it("is sent ONLY when the room is private and has no house", () => {
    /*
      Both halves of the condition matter and for different reasons: without
      `privateByGuests` a public room would carry a guest list the service has
      no use for, and without the house check we would send `guests` alongside
      `houseConversationId`, which is a 400.
    */
    assert.match(
      sheet,
      /\.\.\.\(privateByGuests && guests\.length > 0 \? \{ guests \} : \{\}\)/u,
      "the create body must gate `guests` on a house-less private room"
    );
    assert.match(
      sheet,
      /const privateByGuests =\s*audience === "private" && !houseConversationId/u,
      "privateByGuests is what that gate means — keep the two together"
    );
  });

  it("refuses to create a private room nobody was invited to", () => {
    /*
      The service would accept it. The room would exist, be private, and be
      reachable by its host alone — a room with nobody in it, discovered only
      when nobody arrives.
    */
    assert.match(
      sheet,
      /\(!privateByGuests \|\| guests\.length > 0\)/u,
      "submit must be blocked while a house-less private room has no guests"
    );
  });

  it("offers Private from the street only where somebody can be picked", () => {
    assert.match(
      sheet,
      /disabled=\{!houseConversationId && !canInvite\}/u,
      "without a picker there is nobody to be private to, so Private stays off"
    );
    assert.match(
      sheet,
      /const canInvite = Boolean\(guestPickerSlot\)/u,
      "the picker's presence is the capability — do not infer it some other way"
    );
  });

  it("says who private means, and it is not always a group", () => {
    // "(only group members)" shipped as the hint for both cases, which told a
    // host opening from the street that their room was shut to a group they
    // had never chosen.
    assert.match(
      sheet,
      /hint=\{houseConversationId \? "\(only group members\)" : "\(only people you invite\)"\}/u,
      "the hint has to follow the context, not assume a house"
    );
  });

  it("warns that PUBLIC from inside a house is public to all of Square", () => {
    // Read inside a house, "public" is taken to mean "public to the house".
    assert.ok(
      sheet.includes("Visible to everyone on Square, not just this house"),
      "a house's public option must say it is not scoped to the house"
    );
  });

  it("documents the cap and the refusal on the request type", () => {
    assert.match(api, /guests\?: string\[\]/u, "`guests` must be on the typed input");
    /*
      A spread bypasses TypeScript's excess-property check, so the field
      typechecked perfectly while being absent from the type entirely. The type
      is what tells the next caller the field exists at all.
    */
    assert.ok(
      api.includes("REFUSED alongside `houseConversationId`"),
      "the pair being refused is the surprising half and belongs in the doc"
    );
  });
});
