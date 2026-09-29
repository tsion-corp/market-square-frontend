import { MAX_ROUNDS, POINTS_PER_ROUND } from "./simon.ts";

/*
  A CHALLENGE, AS IT TRAVELS IN A MESSAGE.

  There is no table behind this feature. The thread already is an ordered,
  durable, per-person log, so the challenge lives in the message text and the
  opponent's attempt lives in a reply. That is why v1 needs nothing built on
  either backend — and it is also why this file is strict: the message IS the
  wire format, and a loose parser here is a card that renders someone else's
  words as a game.

  ─── WHY A LINK AND NOT A CODE ──────────────────────────────────────────────
  The thread renders a challenge as a card. If anything ever fails to — an old
  cached bundle, a client we have not thought of — the message still has to
  mean something to the person reading it. A sentence plus a link degrades into
  a sentence plus a link. A bare token degrades into line noise.

  ─── WHY THE PARSER IGNORES THE ORIGIN ──────────────────────────────────────
  One app, two addresses: square.tsionark.com and www.tsionark.com/square. A
  challenge sent from one build is read in the other, so the sender writes its
  OWN absolute URL and the reader matches on the path alone. Pinning an origin
  here would make every challenge sent from the mounted build unreadable on the
  standalone site, and the failure would look like "games don't work for some
  people".

  ─── WHAT THIS DELIBERATELY DOES NOT DEFEND ─────────────────────────────────
  Anyone can type a message that looks like a challenge and claim any score.
  There is no signature here and there cannot usefully be one, because the
  sequence is already computable from the seed.

  So the rule that actually matters is enforced at the call site, not here:
  THE SCORE REPORTED TO GAMEARENA COMES FROM THE PLAY SESSION, NEVER FROM A
  PARSED MESSAGE. A forged message can inflate a card in one thread. It must
  never be able to reach a leaderboard.
*/

/** Only Simon today. The path carries the game so a second one does not need a
    second format — and so an unknown game is ignored rather than guessed. */
export const SIMON_GAME = "simon";

/** What a seed may contain and how long it may be. `newSeed` makes 64 hex
    characters; the bound is wide enough for that and narrow enough that a seed
    can never carry a path segment, a query, or markup into the card. */
const SEED_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** The most a Simon game can be worth. A score past this did not come from the
    game, so the message is not a challenge. */
const MAX_SCORE = MAX_ROUNDS * POINTS_PER_ROUND;

export interface SimonChallenge {
  seed: string;
  /** The sender's score — what the reader is being asked to beat. */
  score: number;
}

/** `/g/simon/<seed>?s=<score>` — the route, unprefixed. Callers pass it
    through `sq()` for the build they are in. */
export function challengePath(seed: string, score: number): string {
  if (!SEED_PATTERN.test(seed)) throw new RangeError("not a usable seed");
  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
    throw new RangeError(`not a Simon score: ${score}`);
  }
  return `/g/${SIMON_GAME}/${seed}?s=${score}`;
}

/**
 * The message a challenge is sent as.
 *
 * The sentence is first so the thread's own preview — the inbox row, a
 * notification — reads as words rather than as a URL.
 */
export function challengeMessage(absoluteUrl: string, score: number): string {
  return `Simon · ${score} — beat it\n${absoluteUrl}`;
}

/**
 * Read a challenge out of a message, or decide it is not one.
 *
 * Returns null rather than throwing: this runs over EVERY message in a thread,
 * and a message that is not a challenge is the overwhelmingly common case, not
 * an error.
 */
export function parseChallenge(text: string | null | undefined): SimonChallenge | null {
  if (typeof text !== "string" || text.length === 0) return null;

  // Match the path anywhere in the message, with or without an origin and with
  // or without the `/square` mount prefix. The score is required: a link with
  // no score is not a challenge anyone can answer.
  const match = /(?:^|[\s(<])(?:\S*?)\/g\/simon\/([A-Za-z0-9_-]{8,128})\?s=(\d{1,6})\b/.exec(text);
  if (!match) return null;

  const [, seed, rawScore] = match;
  if (!SEED_PATTERN.test(seed)) return null;

  const score = Number(rawScore);
  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) return null;

  return { seed, score };
}

/**
 * Whether two challenges are the same game.
 *
 * The card pairs a challenge with the reply that answers it, and the seed is
 * what makes them a pair — two challenges in one thread must not merge into
 * one card just because they are adjacent.
 */
export function isSameChallenge(a: SimonChallenge, b: SimonChallenge): boolean {
  return a.seed === b.seed;
}
