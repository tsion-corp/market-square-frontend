import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { encodeShareCode, decodeShareCode } from "../vendor/arkplay-engine/dna/codec.ts";
import { ENGINE_VERSION } from "../vendor/arkplay-engine/version.ts";

/*
  THE BORROWED CODEC, AND THE ONE THING IT DOES NOT DO.

  Square encodes avatars on its own server because the avatar service
  publishes no route that does (see vendor/arkplay-engine/README.md). These pin
  the two facts the route handler depends on.
*/

const starters = (
  JSON.parse(
    readFileSync(new URL("../public/avatar-studio/starters.json", import.meta.url), "utf8"),
  ) as { starters: { id: string; dna: unknown }[] }
).starters;

describe("the avatar codec", () => {
  it("turns a real avatar into a share code that decodes back to it", () => {
    for (const s of starters) {
      const code = encodeShareCode(s.dna as never);
      assert.ok(code.length > 0, `${s.id} encodes`);
      const decoded = decodeShareCode(code) as { dna?: unknown };
      const back = (decoded?.dna ?? decoded) as { kind?: string; seed?: number };
      const original = s.dna as { kind: string; seed: number };
      assert.equal(back.kind, original.kind, `${s.id} keeps its kind`);
      assert.equal(back.seed, original.seed, `${s.id} keeps its seed`);
    }
  });

  /*
    THE TRAP, PINNED. `encodeShareCode` does NOT reject a document that is not
    an avatar — it NORMALISES, filling everything missing from the defaults and
    answering a perfectly good code for a DEFAULT character. Treating it as a
    validator shipped a route that answered 200 to `{ nope: 1 }`, which would
    have saved somebody a stranger's face with nothing on screen to say so.

    So this asserts the surprising behaviour rather than the comfortable one:
    if a future version starts throwing, this test fails and whoever is here
    can simplify the route instead of discovering the check was dead.
  */
  it("normalises nonsense instead of refusing it — so callers must check shape", () => {
    const code = encodeShareCode({ nope: 1 } as never);
    assert.equal(typeof code, "string");
    assert.ok(code.length > 0, "nonsense still encodes, which is why the route validates");
  });

  /*
    Encoding walks the item schema, so a copy pinned at one engine version can
    fall behind a wardrobe that is fetched live. The studio compares these two
    and warns; this pins that there is a version to compare.
  */
  it("states the engine version the studio guards against", () => {
    assert.match(ENGINE_VERSION, /^\d+\.\d+\.\d+$/);
  });
});
