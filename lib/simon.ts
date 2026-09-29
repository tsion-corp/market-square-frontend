import { keccak256, toHex } from "viem";

/*
  SIMON, AS A CHALLENGE RATHER THAN A SOLO GAME.

  "I got 12 — beat it" only means something if the person beating it plays the
  SAME sequence. A per-device random sequence would make every comparison an
  argument about who got the kind draw, so the sequence is derived from the
  challenge's seed instead: same seed, same pads, same order, on every device
  and in every browser, forever.

  Derivation is keccak256 rather than a hand-rolled PRNG. Not for anything
  cryptographic — it is simply a hash that is specified, identical everywhere,
  and already in the bundle for the match engine, which is three properties a
  seeded Math.random substitute does not have.

  WHAT THIS DOES NOT DO: stop a determined player cheating. The seed is in the
  challenge link, so anyone who can read it can compute the whole sequence
  ahead of time and play it perfectly. That is unavoidable for a game that runs
  on the player's own device, and it is why a score from here is a SOCIAL score
  — fine for bragging in a thread, never the thing a leaderboard trusts. A
  score that counts has to come back through a server that issued the sequence
  itself. Nothing in this file should be read as a defence against that.
*/

/** The four pads. Kept as a count rather than an enum because every consumer
    wants to index an array of colours with it. */
export const PAD_COUNT = 4;

/** Where a round's sequence stops growing. A human topping out around 20 is
    exceptional, so this is a bound on runaway loops rather than a difficulty
    ceiling anyone will reach. */
export const MAX_ROUNDS = 64;

/**
 * The pad shown at one position of a challenge's sequence.
 *
 * A byte is taken from the hash and reduced mod 4. That reduction is exactly
 * unbiased because 256 divides evenly by 4 — worth stating, since the same
 * trick with, say, 6 pads would quietly favour the low ones.
 */
export function padAt(seed: string, index: number): number {
  if (!seed) throw new RangeError("a challenge needs a seed");
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`not a position: ${index}`);
  }
  const hash = keccak256(toHex(`${seed}:${index}`));
  // hash is 0x + 64 hex chars; the first byte is chars 2-3.
  const firstByte = Number.parseInt(hash.slice(2, 4), 16);
  return firstByte % PAD_COUNT;
}

/**
 * The first `length` pads of a challenge.
 *
 * Round n is the first n pads, so round n+1 always begins with exactly the
 * round the player just completed. That prefix property IS the game — Simon
 * repeats what you have seen and adds one — and it falls out of deriving each
 * position independently rather than regenerating a fresh sequence per round.
 */
export function sequenceFor(seed: string, length: number): number[] {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError(`not a length: ${length}`);
  }
  if (length > MAX_ROUNDS) {
    throw new RangeError(`sequence beyond ${MAX_ROUNDS} rounds`);
  }
  return Array.from({ length }, (_, i) => padAt(seed, i));
}

/** A fresh challenge id. Doubled because one uuid's worth of entropy is
    plenty, but the string is also what a player sees in a link, and a longer
    one is not worth the ugliness — this is two joined and stripped. */
export function newSeed(random: () => string = () => globalThis.crypto.randomUUID()): string {
  return `${random()}${random()}`.replace(/-/g, "");
}

export type InputVerdict = "correct" | "round-complete" | "wrong";

/**
 * Judge one pad press, given everything pressed so far this round.
 *
 * Deliberately not a "check the whole round at the end" function: Simon fails
 * you on the press, not on the round, and a player who has to finish entering
 * a sequence they already know is wrong would feel the lag as a bug.
 */
export function judgePress(
  seed: string,
  round: number,
  pressedSoFar: readonly number[],
  press: number,
): InputVerdict {
  if (!Number.isInteger(round) || round < 1) throw new RangeError(`not a round: ${round}`);
  if (pressedSoFar.length >= round) throw new RangeError("round already finished");
  if (!Number.isInteger(press) || press < 0 || press >= PAD_COUNT) return "wrong";
  if (padAt(seed, pressedSoFar.length) !== press) return "wrong";
  return pressedSoFar.length + 1 === round ? "round-complete" : "correct";
}

/**
 * The score a finished game is worth: rounds fully completed.
 *
 * Failing in round 5 scores 4, because 4 is what the player actually did. It
 * is also the number that makes "beat it" legible — the challenger's 12 and
 * the challenger's opponent's 13 mean the same thing.
 */
export function scoreForFailedRound(round: number): number {
  if (!Number.isInteger(round) || round < 1) throw new RangeError(`not a round: ${round}`);
  return round - 1;
}

/** Who wins a challenge. Equal scores are a draw rather than a win for
    whoever happened to play first. */
export function challengeWinner(
  challengerScore: number,
  opponentScore: number,
): "challenger" | "opponent" | null {
  if (opponentScore > challengerScore) return "opponent";
  if (challengerScore > opponentScore) return "challenger";
  return null;
}
