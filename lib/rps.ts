import { keccak256, toHex } from "viem";

/**
 * ROCK PAPER SCISSORS, BEST OF FIVE, PLAYED BETWEEN TWO PEOPLE WHO DO NOT
 * TRUST EACH OTHER — and who have no server between them.
 *
 * ─── WHY COMMIT-REVEAL, AND WHY THIS EXACT SCHEME ────────────────────────────
 * Two people in a DM take turns, which means one of them always moves SECOND.
 * If a move were sent in the clear, the second player would simply read it and
 * win every round. There is no version of "play fair" that survives that, and
 * no amount of UI stops somebody reading their own network tab.
 *
 * So a move is sent as `keccak256(move + salt)` FIRST, and the move itself only
 * after both commitments exist. By then it is too late to change: the hash was
 * already sent and cannot be made to mean a different move.
 *
 * This is GameArena's own scheme, on purpose. `games-backend/lib/arenaMatch.js`
 * uses keccak-committed seeds for exactly this reason against MARKOV, and
 * reusing it means a match played in a DM can be verified by the same code
 * that verifies a match played on their site.
 *
 * ─── WHAT THIS MODULE IS NOT ─────────────────────────────────────────────────
 * Pure. No network, no storage, no React. The transport is the caller's problem
 * — in a DM the thread itself carries the commitments and reveals — and this
 * file only answers "is that legal" and "who won". That is what lets
 * `node --test` attack it without a browser.
 */

export const MOVES = ["rock", "paper", "scissors"] as const;
export type Move = (typeof MOVES)[number];

/** Best of five: the first to three wins, so a match is 3..5 rounds. */
export const ROUNDS_TO_WIN = 3;

/**
 * A commitment to a move.
 *
 * The salt is what stops the commitment being guessable: there are only THREE
 * possible moves, so `keccak256("rock")` is a rainbow table with three entries
 * in it. Without a salt the scheme is decorative — the opponent hashes all
 * three and reads yours off in a microsecond.
 */
export function commitMove(move: Move, salt: string): `0x${string}` {
  if (!MOVES.includes(move)) throw new RangeError(`not a move: ${move}`);
  if (salt.length < 16) throw new RangeError("salt too short to hide three options");
  return keccak256(toHex(`${move}:${salt}`));
}

/** A salt with enough entropy that the three moves cannot be tried against it. */
export function newSalt(random: () => string = () => globalThis.crypto.randomUUID()): string {
  return `${random()}${random()}`.replace(/-/g, "");
}

/**
 * Does this revealed move match what was committed?
 *
 * The ONLY thing standing between this game and a cheat, so it is a plain
 * recomputation rather than anything clever: hash what they claim they played
 * and compare it with what they sent before they could see the answer.
 */
export function revealMatchesCommit(
  commitment: string,
  move: Move,
  salt: string,
): boolean {
  if (!MOVES.includes(move)) return false;
  try {
    return commitMove(move, salt).toLowerCase() === commitment.toLowerCase();
  } catch {
    // A salt too short to be legal cannot have produced a legal commitment.
    return false;
  }
}

/** Who wins one round. `null` is a draw, which is replayed rather than scored. */
export function roundWinner(a: Move, b: Move): "a" | "b" | null {
  if (a === b) return null;
  const beats: Record<Move, Move> = { rock: "scissors", paper: "rock", scissors: "paper" };
  return beats[a] === b ? "a" : "b";
}

export interface MatchScore {
  a: number;
  b: number;
}

/**
 * The score after a run of rounds, and whether the match is over.
 *
 * A DRAW IS NOT A ROUND ANYBODY WON, and it does not count toward the three.
 * Replaying it is what people expect from the playground game, and a "best of
 * five" that can end 2–1 with two draws is not best of five.
 */
export function scoreRounds(rounds: readonly { a: Move; b: Move }[]): MatchScore {
  let a = 0;
  let b = 0;
  for (const round of rounds) {
    if (a >= ROUNDS_TO_WIN || b >= ROUNDS_TO_WIN) break; // decided; later rounds are noise
    const winner = roundWinner(round.a, round.b);
    if (winner === "a") a += 1;
    else if (winner === "b") b += 1;
  }
  return { a, b };
}

/** The match winner, or null while it is still running. */
export function matchWinner(score: MatchScore): "a" | "b" | null {
  if (score.a >= ROUNDS_TO_WIN) return "a";
  if (score.b >= ROUNDS_TO_WIN) return "b";
  return null;
}
