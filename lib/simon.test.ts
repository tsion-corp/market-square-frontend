import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_ROUNDS,
  PAD_COUNT,
  challengeWinner,
  judgePress,
  newSeed,
  padAt,
  scoreForFailedRound,
  sequenceFor,
} from "./simon.ts";

/*
  THE CHALLENGE IS ONLY FAIR IF BOTH PEOPLE PLAY THE SAME SEQUENCE.

  Everything a player will argue about lives in this file: that the second
  player didn't get an easier draw, that the game didn't change its mind about
  a pad halfway through, and that a 13 really did beat a 12.
*/
describe("the same seed is the same game, everywhere", () => {
  it("gives identical sequences across separate calls", () => {
    const seed = "a-challenge-seed";
    assert.deepEqual(sequenceFor(seed, 20), sequenceFor(seed, 20));
  });

  it("gives different games to different seeds", () => {
    // Not a guarantee for any single pad (there are only four), so this
    // compares a long run, where agreement would mean the seed is ignored.
    assert.notDeepEqual(sequenceFor("seed-one", 24), sequenceFor("seed-two", 24));
  });

  it("refuses a challenge with no seed", () => {
    assert.throws(() => padAt("", 0), RangeError);
  });
});

/*
  THE PREFIX PROPERTY IS THE GAME. Simon repeats everything you have already
  seen and adds one. If round 6 were a fresh sequence rather than round 5 plus
  a pad, the player would be re-learning from scratch each round and every
  score would collapse to luck.
*/
describe("each round extends the last", () => {
  it("round n+1 starts with exactly round n", () => {
    const seed = "prefix-check";
    for (let round = 1; round < 30; round++) {
      const shorter = sequenceFor(seed, round);
      const longer = sequenceFor(seed, round + 1);
      assert.deepEqual(longer.slice(0, round), shorter, `round ${round + 1} changed round ${round}`);
      assert.equal(longer.length, round + 1);
    }
  });

  it("a position never changes once played", () => {
    const seed = "stable";
    const early = padAt(seed, 7);
    sequenceFor(seed, 40);
    assert.equal(padAt(seed, 7), early);
  });
});

describe("the pads are drawn evenly", () => {
  /*
    A byte reduced mod 4 is exactly unbiased because 256 divides by 4. This
    asserts it rather than trusting the arithmetic, because the same line with
    a pad count that did NOT divide 256 would quietly favour the low pads and
    nobody would see it in play — they would just feel that green came up a
    lot.
  */
  it("uses all four pads at roughly equal rates", () => {
    const counts = [0, 0, 0, 0];
    const samples = 4000;
    for (let i = 0; i < samples; i++) counts[padAt("distribution", i)]++;
    const expected = samples / PAD_COUNT;
    for (const [pad, n] of counts.entries()) {
      assert.ok(n > 0, `pad ${pad} never appeared`);
      // Generous band: this is checking for a systematic skew, not testing
      // keccak's statistical properties.
      assert.ok(
        Math.abs(n - expected) < expected * 0.15,
        `pad ${pad} appeared ${n} times, expected about ${expected}`,
      );
    }
  });

  it("only ever returns a real pad", () => {
    for (let i = 0; i < 500; i++) {
      const pad = padAt("range", i);
      assert.ok(Number.isInteger(pad) && pad >= 0 && pad < PAD_COUNT, `bad pad: ${pad}`);
    }
  });
});

describe("a press is judged on the press", () => {
  const seed = "judging";

  it("accepts the right pad and completes the round on the last one", () => {
    const round = 4;
    const correct = sequenceFor(seed, round);
    const pressed: number[] = [];
    for (let i = 0; i < round; i++) {
      const verdict = judgePress(seed, round, pressed, correct[i]);
      assert.equal(verdict, i === round - 1 ? "round-complete" : "correct");
      pressed.push(correct[i]);
    }
  });

  it("fails the moment a pad is wrong, not at the end of the round", () => {
    const round = 5;
    const correct = sequenceFor(seed, round);
    const wrong = (correct[0] + 1) % PAD_COUNT;
    assert.equal(judgePress(seed, round, [], wrong), "wrong");
  });

  it("rejects a pad that does not exist", () => {
    assert.equal(judgePress(seed, 3, [], PAD_COUNT), "wrong");
    assert.equal(judgePress(seed, 3, [], -1), "wrong");
    assert.equal(judgePress(seed, 3, [], 1.5), "wrong");
  });

  it("refuses to judge a round that is already over", () => {
    const correct = sequenceFor(seed, 2);
    assert.throws(() => judgePress(seed, 2, correct, correct[0]), RangeError);
  });

  it("refuses a round that is not a round", () => {
    assert.throws(() => judgePress(seed, 0, [], 0), RangeError);
    assert.throws(() => judgePress(seed, -1, [], 0), RangeError);
  });

  /*
    The right pad in the WRONG PLACE is the mistake players actually make —
    pressing a pad that is in the sequence, just not the one due now.
  */
  it("rejects a pad that is in the sequence but not due yet", () => {
    const round = 6;
    const correct = sequenceFor(seed, round);
    const later = correct.find((p, i) => i > 0 && p !== correct[0]);
    if (later === undefined) return; // vanishingly unlikely; nothing to assert
    assert.equal(judgePress(seed, round, [], later), "wrong");
  });
});

describe("the score is what the player actually did", () => {
  it("scores the rounds completed, not the round reached", () => {
    assert.equal(scoreForFailedRound(5), 4);
    assert.equal(scoreForFailedRound(1), 0);
  });

  it("refuses a round that is not a round", () => {
    assert.throws(() => scoreForFailedRound(0), RangeError);
  });
});

describe("beating a score", () => {
  it("needs strictly more, so a tie is a draw", () => {
    assert.equal(challengeWinner(12, 13), "opponent");
    assert.equal(challengeWinner(12, 12), null);
    assert.equal(challengeWinner(12, 11), "challenger");
  });

  it("does not favour whoever played first", () => {
    assert.equal(challengeWinner(0, 0), null);
  });
});

describe("challenge seeds", () => {
  it("do not repeat", () => {
    const seeds = new Set(Array.from({ length: 200 }, () => newSeed()));
    assert.equal(seeds.size, 200, "a repeated seed replays someone else's game");
  });
});

describe("bounds", () => {
  it("refuses a sequence longer than the cap", () => {
    assert.throws(() => sequenceFor("cap", MAX_ROUNDS + 1), RangeError);
    assert.equal(sequenceFor("cap", MAX_ROUNDS).length, MAX_ROUNDS);
  });

  it("treats a zero-length sequence as empty rather than an error", () => {
    assert.deepEqual(sequenceFor("zero", 0), []);
  });

  it("refuses a nonsense length or position", () => {
    assert.throws(() => sequenceFor("x", -1), RangeError);
    assert.throws(() => sequenceFor("x", 1.5), RangeError);
    assert.throws(() => padAt("x", -1), RangeError);
  });
});
