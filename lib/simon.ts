import { keccak256, toHex } from "viem";

/*
  SIMON, MATCHING GAMEARENA'S OWN.

  This is not a Simon-like game of our own: it is THEIR game, played inside a
  Square thread, so that a Square player's score means the same thing a score
  on their site means. Every number below was taken from their implementation
  rather than chosen here — the acceleration, the floors, the fifth pad, the
  ten-points-a-round. Changing one silently makes the two incomparable, which
  is the whole reason the game is here.

  ─── THE SEQUENCE IS DERIVED FROM A SEED ───────────────────────────────────
  "I got 12 — beat it" only means something if the person beating it plays the
  SAME sequence, so the pads come from the challenge's seed rather than from
  each device's own randomness.

  ─── AND THAT MAKES IT A SOCIAL SCORE, NOT A TRUSTED ONE ────────────────────
  The seed travels with the challenge, so anyone who reads it can compute the
  whole sequence ahead and play perfectly. That is unavoidable for a game
  running on the player's own device.

  GameArena's Simon is SERVER-AUTHORITATIVE — their server issues the sequence
  and recomputes the submitted score against it, so a client cannot post a
  number it did not earn. A score from here has not been through that, which is
  why these scores belong on their own board and must not be mixed into the
  validated one.

  `sequenceFor` is therefore the ONLY thing that would change to make these
  scores trustworthy: swap the seed-derived sequence for one the server issued
  and the rest of the game is already correct. Keep it that way.
*/

/** The pads at the start: green, red, yellow, blue. */
export const BASE_PADS = 4;

/** The round the fifth pad (purple) joins, from GameArena's Simon. */
export const FIFTH_PAD_ROUND = 5;

/** Every pad once the fifth has appeared. */
export const MAX_PADS = 5;

/** GameArena scores ten points per round CLEARED, not per pad pressed. */
export const POINTS_PER_ROUND = 10;

/** Their hard cap on a single game. Memory under pressure stops being a game
    long before this, but an un-capped loop is not a game either. */
export const MAX_GAME_MS = 10 * 60 * 1000;

/** Where a sequence stops growing. Far past any human ceiling; this bounds
    runaway loops, not difficulty. */
export const MAX_ROUNDS = 64;

/**
 * How many pads are in play for a given round — four, then five from round 5.
 */
export function padsForRound(round: number): number {
  if (!Number.isInteger(round) || round < 1)
    throw new RangeError(`not a round: ${round}`);
  return round >= FIFTH_PAD_ROUND ? MAX_PADS : BASE_PADS;
}

/**
 * How long a pad stays lit, and how often a flash STARTS — both accelerate as
 * the rounds climb, then stop. GameArena's exact curves and floors.
 *
 * `gapMs` is the interval between one flash beginning and the next beginning,
 * NOT the dark stretch between them. That distinction is the whole rhythm of
 * the game: read as dark time, round one would run 470 lit + 665 dark for a
 * 1135ms cycle, nearly twice the real 665ms. A player who practised on their
 * site would find Square's Simon slow and easy under the same score, which is
 * exactly the incomparability that matching their constants was meant to
 * prevent. Use `darkMs` for the pause; never `gapMs`.
 */
export function flashMs(round: number): number {
  if (!Number.isInteger(round) || round < 1)
    throw new RangeError(`not a round: ${round}`);
  return Math.max(200, 500 - round * 30);
}
export function gapMs(round: number): number {
  if (!Number.isInteger(round) || round < 1)
    throw new RangeError(`not a round: ${round}`);
  return Math.max(350, 700 - round * 35);
}

/**
 * The dark stretch between one pad going out and the next lighting.
 *
 * Derived rather than given, because it is `gapMs` minus the lit window and
 * deriving it is what stops the two being confused at a call site. It stays
 * positive across the whole curve — the floors are 200 lit against a 350
 * interval — so pads never overlap, and a test pins that rather than trusting
 * the arithmetic to hold at every round.
 */
export function darkMs(round: number): number {
  return Math.max(0, gapMs(round) - flashMs(round));
}

/**
 * A position's pad count is fixed by the round that ADDED it, not by the round
 * being played.
 *
 * This is what keeps the prefix property true across the fifth pad's arrival.
 * Position i first appears in round i+1, so positions 0-3 were drawn from four
 * pads and stay that way forever; position 4 onwards is drawn from five. If
 * this read the CURRENT round instead, reaching round 5 would silently redraw
 * the first four pads and the player would be repeating a sequence they were
 * never shown.
 */
function padsAtPosition(index: number): number {
  return padsForRound(index + 1);
}

/**
 * One pad of a challenge's sequence.
 *
 * ─── WHY THIS IS NOT `byte % padCount` ──────────────────────────────────────
 * With four pads that would be exactly fair, because 256 divides by 4. With
 * FIVE it is not: 256 = 51*5 + 1, so one value of the byte has no partner and
 * the lowest pad would come up slightly more often than the rest. Nobody would
 * see a bug — they would just feel that purple was rare.
 *
 * So bytes at or above the largest whole multiple of the pad count are
 * REJECTED rather than folded, and the next byte of the hash is tried. Thirty-
 * two bytes make exhausting them vanishingly unlikely, and re-hashing with a
 * counter covers even that rather than falling back to a biased answer.
 */
export function padAt(seed: string, index: number): number {
  if (!seed) throw new RangeError("a challenge needs a seed");
  if (!Number.isInteger(index) || index < 0)
    throw new RangeError(`not a position: ${index}`);

  const pads = padsAtPosition(index);
  const limit = Math.floor(256 / pads) * pads; // largest whole multiple of `pads`

  for (let attempt = 0; attempt < 64; attempt++) {
    const hash = keccak256(
      toHex(attempt === 0 ? `${seed}:${index}` : `${seed}:${index}:${attempt}`),
    );
    // Skip the leading "0x", then read the 32 bytes as hex pairs.
    for (let byteIndex = 0; byteIndex < 32; byteIndex++) {
      const start = 2 + byteIndex * 2;
      const byte = Number.parseInt(hash.slice(start, start + 2), 16);
      if (byte < limit) return byte % pads;
    }
  }
  // Unreachable in practice: it needs 2048 consecutive rejected bytes, each
  // with probability <= 1/256. Throwing beats silently returning a biased pad.
  throw new Error("could not draw an unbiased pad");
}

/**
 * The first `length` pads of a challenge.
 *
 * Round n is the first n pads, so round n+1 always opens with exactly the
 * round just completed — the prefix property that IS Simon. It falls out of
 * deriving each position independently instead of regenerating per round.
 *
 * THE SEAM: to put these scores on GameArena's validated leaderboard, this is
 * the function that changes — it would return the sequence their server
 * issued. Everything else in the game stays as it is.
 */
export function sequenceFor(seed: string, length: number): number[] {
  if (!Number.isInteger(length) || length < 0)
    throw new RangeError(`not a length: ${length}`);
  if (length > MAX_ROUNDS)
    throw new RangeError(`sequence beyond ${MAX_ROUNDS} rounds`);
  return Array.from({ length }, (_, i) => padAt(seed, i));
}

/** A fresh challenge id. */
export function newSeed(
  random: () => string = () => globalThis.crypto.randomUUID(),
): string {
  return `${random()}${random()}`.replace(/-/g, "");
}

export type InputVerdict = "correct" | "round-complete" | "wrong";

/**
 * Judge one pad press against everything pressed so far this round.
 *
 * Judged on the press, not at the end of the round, because that is when Simon
 * fails you — a player who has already gone wrong should not have to finish
 * entering a sequence to be told.
 */
export function judgePress(
  seed: string,
  round: number,
  pressedSoFar: readonly number[],
  press: number,
): InputVerdict {
  if (!Number.isInteger(round) || round < 1)
    throw new RangeError(`not a round: ${round}`);
  if (pressedSoFar.length >= round)
    throw new RangeError("round already finished");
  if (!Number.isInteger(press) || press < 0 || press >= padsForRound(round))
    return "wrong";
  if (padAt(seed, pressedSoFar.length) !== press) return "wrong";
  return pressedSoFar.length + 1 === round ? "round-complete" : "correct";
}

/**
 * What a finished game is worth: ten points per round CLEARED.
 *
 * Failing in round 5 scores 40, because four rounds is what the player
 * actually did. The multiplier is GameArena's, so a 120 here reads as the same
 * achievement as a 120 there.
 */
export function scoreForFailedRound(round: number): number {
  if (!Number.isInteger(round) || round < 1)
    throw new RangeError(`not a round: ${round}`);
  return (round - 1) * POINTS_PER_ROUND;
}

/** Who wins a challenge. Equal scores draw, rather than handing it to whoever
    happened to play first. */
export function challengeWinner(
  challengerScore: number,
  opponentScore: number,
): "challenger" | "opponent" | null {
  if (opponentScore > challengerScore) return "opponent";
  if (challengerScore > opponentScore) return "challenger";
  return null;
}
