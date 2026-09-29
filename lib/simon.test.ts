import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BASE_PADS,
  FIFTH_PAD_ROUND,
  MAX_PADS,
  MAX_ROUNDS,
  POINTS_PER_ROUND,
  challengeWinner,
  flashMs,
  gapMs,
  judgePress,
  newSeed,
  padAt,
  padsForRound,
  scoreForFailedRound,
  sequenceFor,
} from "./simon.ts";

/*
  THIS IS GAMEARENA'S SIMON, SO THE NUMBERS ARE THEIRS.

  The point of the game living in a Square thread is that a score here means
  what a score on their site means. Every constant below is pinned against
  their implementation — if one drifts, the two stop being the same game and
  nobody finds out from playing it.
*/
describe("the game is GameArena's, to the number", () => {
  it("lights a pad on their curve, with their floor", () => {
    assert.equal(flashMs(1), 470);
    assert.equal(flashMs(5), 350);
    assert.equal(flashMs(10), 200);
    // 500 - 30r would keep falling; theirs stops at 200.
    assert.equal(flashMs(20), 200);
    assert.equal(flashMs(60), 200);
  });

  it("gaps the flashes on their curve, with their floor", () => {
    assert.equal(gapMs(1), 665);
    assert.equal(gapMs(5), 525);
    assert.equal(gapMs(10), 350);
    assert.equal(gapMs(30), 350);
  });

  it("speeds up every round until the floor", () => {
    for (let round = 1; round < 10; round++) {
      assert.ok(flashMs(round + 1) <= flashMs(round), `flash grew at round ${round}`);
      assert.ok(gapMs(round + 1) <= gapMs(round), `gap grew at round ${round}`);
    }
  });

  it("scores ten a round, not one", () => {
    assert.equal(POINTS_PER_ROUND, 10);
    assert.equal(scoreForFailedRound(5), 40);
    assert.equal(scoreForFailedRound(13), 120);
    assert.equal(scoreForFailedRound(1), 0);
  });

  it("brings the fifth pad in at round five", () => {
    assert.equal(padsForRound(FIFTH_PAD_ROUND - 1), BASE_PADS);
    assert.equal(padsForRound(FIFTH_PAD_ROUND), MAX_PADS);
    assert.equal(padsForRound(40), MAX_PADS);
  });

  it("refuses a round that is not a round", () => {
    for (const bad of [0, -1, 1.5]) {
      assert.throws(() => padsForRound(bad), RangeError);
      assert.throws(() => flashMs(bad), RangeError);
      assert.throws(() => gapMs(bad), RangeError);
      assert.throws(() => scoreForFailedRound(bad), RangeError);
    }
  });
});

describe("the same seed is the same game, everywhere", () => {
  it("gives identical sequences across separate calls", () => {
    assert.deepEqual(sequenceFor("a-seed", 20), sequenceFor("a-seed", 20));
  });

  it("gives different games to different seeds", () => {
    assert.notDeepEqual(sequenceFor("seed-one", 24), sequenceFor("seed-two", 24));
  });

  it("refuses a challenge with no seed", () => {
    assert.throws(() => padAt("", 0), RangeError);
  });
});

/*
  THE PREFIX PROPERTY IS THE GAME, AND THE FIFTH PAD IS WHERE IT NEARLY BREAKS.

  A position's pad count is fixed by the round that ADDED it. Read the CURRENT
  round instead and arriving at round 5 would redraw the first four pads from
  five options — the player would be asked to repeat a sequence they were never
  shown, and it would look like their own memory failing.
*/
describe("each round extends the last, including across the fifth pad", () => {
  it("round n+1 opens with exactly round n", () => {
    const seed = "prefix";
    for (let round = 1; round < 40; round++) {
      const shorter = sequenceFor(seed, round);
      const longer = sequenceFor(seed, round + 1);
      assert.deepEqual(longer.slice(0, round), shorter, `round ${round + 1} rewrote round ${round}`);
      assert.equal(longer.length, round + 1);
    }
  });

  it("never puts the fifth pad in the first four positions", () => {
    // Those positions belong to rounds 1-4, which are four-pad rounds. If any
    // of them could be purple, a round-4 player would see a pad that does not
    // exist yet.
    for (let s = 0; s < 400; s++) {
      for (let i = 0; i < FIFTH_PAD_ROUND - 1; i++) {
        const pad = padAt(`early-${s}`, i);
        assert.ok(pad < BASE_PADS, `position ${i} drew pad ${pad}`);
      }
    }
  });

  it("does use the fifth pad from the fifth position on", () => {
    let seenPurple = false;
    for (let s = 0; s < 200 && !seenPurple; s++) {
      if (sequenceFor(`late-${s}`, 12).slice(FIFTH_PAD_ROUND - 1).includes(BASE_PADS)) {
        seenPurple = true;
      }
    }
    assert.ok(seenPurple, "the fifth pad never appeared after round five");
  });

  it("does not change a position once it has been played", () => {
    const early = padAt("stable", 7);
    sequenceFor("stable", 40);
    assert.equal(padAt("stable", 7), early);
  });
});

/*
  BIAS IS THE BUG NOBODY REPORTS. A byte folded with `% 5` is not uniform —
  256 = 51*5 + 1, so one pad wins the leftover and comes up about 0.4% more
  than its share. No player files that; they just feel purple is rare. The
  engine rejects the leftover instead of folding it, and this is what proves
  the rejection is actually happening.
*/
describe("the pads are drawn evenly", () => {
  it("is even across four pads in the four-pad positions", () => {
    const counts = new Array<number>(BASE_PADS).fill(0);
    const samples = 3000;
    // Position 0 is a four-pad position, so vary the SEED rather than the index.
    for (let i = 0; i < samples; i++) counts[padAt(`four-${i}`, 0)]++;
    const expected = samples / BASE_PADS;
    for (const [pad, n] of counts.entries()) {
      assert.ok(Math.abs(n - expected) < expected * 0.15, `pad ${pad}: ${n} of ${samples}`);
    }
  });

  it("is even across FIVE pads in the five-pad positions", () => {
    const counts = new Array<number>(MAX_PADS).fill(0);
    const samples = 4000;
    for (let i = 0; i < samples; i++) counts[padAt(`five-${i}`, FIFTH_PAD_ROUND)]++;
    const expected = samples / MAX_PADS;
    for (const [pad, n] of counts.entries()) {
      assert.ok(n > 0, `pad ${pad} never appeared`);
      assert.ok(
        Math.abs(n - expected) < expected * 0.15,
        `pad ${pad} appeared ${n} times of ${samples}, expected about ${expected}`,
      );
    }
  });

  it("only ever returns a pad that is in play", () => {
    for (let i = 0; i < 300; i++) {
      const pad = padAt("range", i);
      const allowed = i < FIFTH_PAD_ROUND - 1 ? BASE_PADS : MAX_PADS;
      assert.ok(Number.isInteger(pad) && pad >= 0 && pad < allowed, `position ${i} drew ${pad}`);
    }
  });
});

describe("a press is judged on the press", () => {
  const seed = "judging";

  it("accepts the right pads and completes the round on the last", () => {
    const round = 6;
    const correct = sequenceFor(seed, round);
    const pressed: number[] = [];
    for (let i = 0; i < round; i++) {
      assert.equal(
        judgePress(seed, round, pressed, correct[i]),
        i === round - 1 ? "round-complete" : "correct",
      );
      pressed.push(correct[i]);
    }
  });

  it("fails on the wrong pad immediately, not at the end of the round", () => {
    const correct = sequenceFor(seed, 5);
    assert.equal(judgePress(seed, 5, [], (correct[0] + 1) % BASE_PADS), "wrong");
  });

  it("rejects the fifth pad in a four-pad round", () => {
    // Round 4 has four pads. Pressing purple there is not a near-miss, it is
    // a press of something that is not on screen.
    assert.equal(judgePress(seed, 4, [], BASE_PADS), "wrong");
  });

  it("rejects a pad that does not exist at all", () => {
    assert.equal(judgePress(seed, 6, [], MAX_PADS), "wrong");
    assert.equal(judgePress(seed, 6, [], -1), "wrong");
    assert.equal(judgePress(seed, 6, [], 1.5), "wrong");
  });

  it("refuses to judge a round that is already over", () => {
    const correct = sequenceFor(seed, 2);
    assert.throws(() => judgePress(seed, 2, correct, correct[0]), RangeError);
  });

  it("refuses a round that is not a round", () => {
    assert.throws(() => judgePress(seed, 0, [], 0), RangeError);
  });

  it("rejects a pad that is in the sequence but not due yet", () => {
    const round = 8;
    const correct = sequenceFor(seed, round);
    const notFirst = correct.find((p, i) => i > 0 && p !== correct[0]);
    if (notFirst === undefined) return;
    assert.equal(judgePress(seed, round, [], notFirst), "wrong");
  });
});

describe("beating a score", () => {
  it("needs strictly more, so a tie is a draw", () => {
    assert.equal(challengeWinner(120, 130), "opponent");
    assert.equal(challengeWinner(120, 120), null);
    assert.equal(challengeWinner(120, 110), "challenger");
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
  it("refuses a sequence past the cap", () => {
    assert.throws(() => sequenceFor("cap", MAX_ROUNDS + 1), RangeError);
    assert.equal(sequenceFor("cap", MAX_ROUNDS).length, MAX_ROUNDS);
  });

  it("treats a zero-length sequence as empty, not an error", () => {
    assert.deepEqual(sequenceFor("zero", 0), []);
  });

  it("refuses a nonsense length or position", () => {
    assert.throws(() => sequenceFor("x", -1), RangeError);
    assert.throws(() => padAt("x", -1), RangeError);
  });
});
