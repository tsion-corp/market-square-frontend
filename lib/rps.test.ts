import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MOVES,
  ROUNDS_TO_WIN,
  commitMove,
  matchWinner,
  newSalt,
  revealMatchesCommit,
  roundWinner,
  scoreRounds,
  type Move,
} from "./rps.ts";

/*
  THE ONLY THING THIS GAME HAS IS THE COMMITMENT.

  Two people in a DM take turns, so one of them always moves SECOND. If a move
  travelled in the clear, the second player reads it and wins every round — and
  no interface prevents somebody reading their own network tab. So these tests
  are written as the cheat, not as the happy path.
*/
describe("a move cannot be changed after the other one is known", () => {
  it("a commitment does not reveal which move it is", () => {
    const salt = "abcdefghijklmnop";
    const hashes = MOVES.map((move) => commitMove(move, salt));
    assert.equal(new Set(hashes).size, 3, "three moves must give three different hashes");
    for (const hash of hashes) {
      assert.doesNotMatch(hash, /rock|paper|scissors/i, "the move must not be readable in the hash");
    }
  });

  it("refuses to reveal a different move than the one committed", () => {
    const salt = newSalt(() => "0123456789abcdef");
    const commitment = commitMove("rock", salt);
    // The cheat: having seen the opponent play paper, claim scissors.
    assert.equal(revealMatchesCommit(commitment, "scissors", salt), false);
    assert.equal(revealMatchesCommit(commitment, "paper", salt), false);
    assert.equal(revealMatchesCommit(commitment, "rock", salt), true);
  });

  it("refuses the right move with the wrong salt", () => {
    const commitment = commitMove("paper", "aaaaaaaaaaaaaaaa");
    assert.equal(revealMatchesCommit(commitment, "paper", "bbbbbbbbbbbbbbbb"), false);
  });

  /*
    THE SALT IS NOT DECORATION. There are only THREE possible moves, so an
    unsalted commitment is a rainbow table with three entries — the opponent
    hashes all three and reads yours off instantly. A short salt is the same
    attack with more steps, so the length is enforced rather than advised.
  */
  it("refuses a salt short enough to brute-force", () => {
    assert.throws(() => commitMove("rock", "short"), RangeError);
    assert.equal(revealMatchesCommit("0xdeadbeef", "rock", "short"), false);
  });

  it("mints salts that do not repeat", () => {
    const salts = new Set(Array.from({ length: 200 }, () => newSalt()));
    assert.equal(salts.size, 200, "a repeated salt makes an old commitment replayable");
    for (const salt of salts) assert.ok(salt.length >= 16, salt);
  });

  it("refuses anything that is not a move", () => {
    const salt = "abcdefghijklmnop";
    assert.throws(() => commitMove("lizard" as Move, salt), RangeError);
    assert.equal(revealMatchesCommit(commitMove("rock", salt), "spock" as Move, salt), false);
  });
});

describe("the rules are the playground rules", () => {
  it("each move beats exactly one and loses to exactly one", () => {
    for (const move of MOVES) {
      const beaten = MOVES.filter((other) => roundWinner(move, other) === "a");
      const lostTo = MOVES.filter((other) => roundWinner(move, other) === "b");
      assert.equal(beaten.length, 1, `${move} must beat exactly one`);
      assert.equal(lostTo.length, 1, `${move} must lose to exactly one`);
    }
  });

  it("is symmetric — swapping the players swaps the result", () => {
    for (const a of MOVES) {
      for (const b of MOVES) {
        const forward = roundWinner(a, b);
        const back = roundWinner(b, a);
        assert.equal(back, forward === null ? null : forward === "a" ? "b" : "a");
      }
    }
  });

  it("calls the same move a draw", () => {
    for (const move of MOVES) assert.equal(roundWinner(move, move), null);
  });
});

describe("best of five means first to three", () => {
  const round = (a: Move, b: Move) => ({ a, b });

  it("ends at three, and ignores rounds played after", () => {
    const rounds = [
      round("rock", "scissors"),
      round("rock", "scissors"),
      round("rock", "scissors"),
      // Anything after the decider must not move the score.
      round("scissors", "rock"),
      round("scissors", "rock"),
    ];
    assert.deepEqual(scoreRounds(rounds), { a: ROUNDS_TO_WIN, b: 0 });
    assert.equal(matchWinner(scoreRounds(rounds)), "a");
  });

  /*
    A DRAW IS NOT A ROUND ANYBODY WON. A "best of five" that can end 2-1 with
    two draws in it is not best of five, and replaying a draw is what everyone
    expects from the playground game.
  */
  it("does not count a draw toward the three", () => {
    const rounds = [
      round("rock", "rock"),
      round("paper", "paper"),
      round("rock", "scissors"),
    ];
    assert.deepEqual(scoreRounds(rounds), { a: 1, b: 0 });
    assert.equal(matchWinner(scoreRounds(rounds)), null, "one win is not a match");
  });

  it("is still running until somebody has three", () => {
    assert.equal(matchWinner({ a: 2, b: 2 }), null);
    assert.equal(matchWinner({ a: 0, b: 0 }), null);
    assert.equal(matchWinner({ a: 2, b: 0 }), null);
  });

  it("cannot be won by both", () => {
    const rounds = [
      round("rock", "scissors"),
      round("scissors", "rock"),
      round("rock", "scissors"),
      round("scissors", "rock"),
      round("rock", "scissors"),
    ];
    const score = scoreRounds(rounds);
    assert.equal(score.a + score.b <= 5, true);
    assert.equal(matchWinner(score), "a");
    assert.ok(score.b < ROUNDS_TO_WIN, "the loser cannot also have three");
  });

  it("scores an empty match as nobody's", () => {
    assert.deepEqual(scoreRounds([]), { a: 0, b: 0 });
    assert.equal(matchWinner({ a: 0, b: 0 }), null);
  });
});
