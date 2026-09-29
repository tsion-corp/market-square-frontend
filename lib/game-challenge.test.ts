import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newSeed } from "./simon.ts";
import {
  challengeMessage,
  challengePath,
  isSameChallenge,
  parseChallenge,
} from "./game-challenge.ts";

const SEED = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

/*
  THE MESSAGE IS THE WIRE FORMAT.

  There is no table behind this feature, so a bug here is not a rendering
  glitch — it is one person's words being read as another person's game, or a
  challenge that silently stops being answerable. This parser runs over every
  message in every thread, so it is attacked here rather than trusted.
*/
describe("a challenge survives the round trip", () => {
  it("reads back exactly what it wrote", () => {
    const path = challengePath(SEED, 120);
    assert.equal(path, `/g/simon/${SEED}?s=120`);
    assert.deepEqual(parseChallenge(`Simon · 120 — beat it\nhttps://square.tsionark.com${path}`), {
      seed: SEED,
      score: 120,
    });
  });

  it("reads a real message built by the sender", () => {
    const seed = newSeed();
    const url = `https://square.tsionark.com${challengePath(seed, 250)}`;
    const parsed = parseChallenge(challengeMessage(url, 250));
    assert.deepEqual(parsed, { seed, score: 250 });
  });

  it("puts the words before the link, so a preview reads as words", () => {
    const message = challengeMessage("https://square.tsionark.com/g/simon/x", 90);
    assert.ok(message.startsWith("Simon · 90 — beat it"), message);
  });

  it("accepts a score of zero, because failing round one is a real result", () => {
    assert.deepEqual(parseChallenge(`https://sq.test${challengePath(SEED, 0)}`), {
      seed: SEED,
      score: 0,
    });
  });
});

/*
  ONE APP, TWO ADDRESSES. A challenge sent from the build Ark mounts at
  /square is read by the standalone site and vice versa. Pinning an origin
  would break exactly one direction, and it would present as "games don't work
  for some people" rather than as a parsing bug.
*/
describe("it does not care which address sent it", () => {
  const cases: Record<string, string> = {
    "the standalone site": `https://square.tsionark.com/g/simon/${SEED}?s=40`,
    "the mounted build": `https://www.tsionark.com/square/g/simon/${SEED}?s=40`,
    "a bare path": `/g/simon/${SEED}?s=40`,
    "a mounted bare path": `/square/g/simon/${SEED}?s=40`,
    "http rather than https": `http://localhost:3000/g/simon/${SEED}?s=40`,
  };
  for (const [name, url] of Object.entries(cases)) {
    it(`reads ${name}`, () => {
      assert.deepEqual(parseChallenge(`Simon · 40 — beat it\n${url}`), { seed: SEED, score: 40 });
    });
  }
});

describe("it refuses what is not a challenge", () => {
  const notChallenges: Record<string, string | null | undefined> = {
    "an ordinary message": "are you around later?",
    "empty": "",
    "null": null,
    "undefined": undefined,
    "the word simon": "simon says hello",
    "a link with no score": `https://square.tsionark.com/g/simon/${SEED}`,
    "a link to another game": `https://square.tsionark.com/g/chess/${SEED}?s=40`,
    "a seed too short to be one": "https://square.tsionark.com/g/simon/abc?s=40",
    "a seed with a path in it": `https://square.tsionark.com/g/simon/${SEED}/../admin?s=40`,
    "a non-numeric score": `https://square.tsionark.com/g/simon/${SEED}?s=lots`,
    "a negative score": `https://square.tsionark.com/g/simon/${SEED}?s=-10`,
  };
  for (const [name, text] of Object.entries(notChallenges)) {
    it(`refuses ${name}`, () => {
      assert.equal(parseChallenge(text), null);
    });
  }

  /*
    A score above the game's ceiling did not come from the game. Accepting it
    would let a typed message put an unbeatable number on a card, and the
    "beat it" it invites would be a lie.
  */
  it("refuses a score the game cannot produce", () => {
    assert.equal(parseChallenge(`https://sq.test/g/simon/${SEED}?s=999999`), null);
  });

  it("refuses a seed carrying characters that are not seed characters", () => {
    assert.equal(parseChallenge(`https://sq.test/g/simon/${"a".repeat(7)}?s=10`), null);
    assert.equal(parseChallenge(`https://sq.test/g/simon/${"a".repeat(129)}?s=10`), null);
  });
});

/*
  THE SCORE ON THE CARD IS NOT THE SCORE ON THE LEADERBOARD.

  Nothing stops someone typing a challenge by hand and claiming any number
  inside the range — there is no signature here and one would be pointless,
  since the sequence is computable from the seed anyway. These tests pin the
  boundary that DOES matter: the parser accepts a plausible message, and the
  rule that a reported score comes from a play session rather than from text
  lives at the call site.
*/
describe("a hand-typed challenge parses, and that is understood", () => {
  it("accepts a message a person could have typed", () => {
    assert.deepEqual(parseChallenge(`/g/simon/${SEED}?s=630`), { seed: SEED, score: 630 });
  });

  it("caps what it will believe at the game's ceiling", () => {
    // 64 rounds x 10 points. One past it is refused, so the range is closed.
    assert.deepEqual(parseChallenge(`/g/simon/${SEED}?s=640`), { seed: SEED, score: 640 });
    assert.equal(parseChallenge(`/g/simon/${SEED}?s=641`), null);
  });
});

describe("building a challenge refuses bad input outright", () => {
  it("refuses an unusable seed", () => {
    assert.throws(() => challengePath("short", 10), RangeError);
    assert.throws(() => challengePath(`${SEED}/x`, 10), RangeError);
  });

  it("refuses a score the game cannot produce", () => {
    assert.throws(() => challengePath(SEED, -1), RangeError);
    assert.throws(() => challengePath(SEED, 641), RangeError);
    assert.throws(() => challengePath(SEED, 1.5), RangeError);
  });
});

describe("pairing a challenge with its answer", () => {
  it("pairs on the seed, not on being adjacent", () => {
    const a = { seed: SEED, score: 120 };
    assert.ok(isSameChallenge(a, { seed: SEED, score: 130 }));
    assert.ok(!isSameChallenge(a, { seed: newSeed(), score: 130 }));
  });
});
