"use client";

import { createContext, useContext } from "react";
import {
  isSettled,
  type ChallengeOutcome,
  type SimonChallenge,
} from "@/lib/game-challenge";

/**
 * The seam between a chat thread and the game that can be played inside it.
 *
 * ─── WHY THIS IS HERE AND NOT IN EITHER SLICE ───────────────────────────────
 * Slices never import each other, so `features/messages` cannot reach
 * `features/games` for a card to draw, and `features/games` has no business
 * knowing what a message looks like. This file is the shared primitive both
 * are allowed to depend on: a context, the hook that reads it, and the card
 * itself, which is presentation and needs nothing from either slice.
 *
 * `features/games` supplies the implementation (the provider and the game
 * overlay). `components/layout` mounts it around the messages screen. The
 * thread only ever sees this file.
 *
 * ─── WHY A CONTEXT RATHER THAN A PROP ───────────────────────────────────────
 * The card is drawn by the thread's single text renderer, which is reached
 * from a bubble, a caption and a reply preview. Threading a handler to each
 * would mean the next call site added forgets it, and the forgetting shows up
 * as a button that silently does nothing rather than as a build error.
 */

/** What a finished game does with its score. Registered by whichever thread
    is open, because only it knows where a message would go. */
export type ChallengeSender = (seed: string, score: number) => void;

export interface ChallengeSlot {
  /** Open the game on an existing challenge, answering its score. */
  openChallenge: (args: { seed: string; targetScore?: number }) => void;
  /** Start a new challenge — a fresh sequence with nothing to beat. */
  startNewChallenge: () => void;
  /**
   * Tell the host how to turn a finished score into a message, and withdraw
   * it on the way out.
   *
   * ─── WHY REGISTRATION RATHER THAN A PROP OR A CONTEXT ───────────────────
   * The overlay must be mounted ABOVE the message list, or virtualisation
   * destroys the game mid-round as the list recycles. But only the open
   * thread knows which conversation a score should be sent to. A provider
   * cannot read from below it, so the thread cannot supply this by context;
   * and the card that opens a game is drawn deep inside the list, so it
   * cannot pass it up either.
   *
   * So the thread registers, and the host calls what is registered. Passing
   * null on unmount is what stops a score from a closed thread being sent
   * into it.
   */
  registerSender: (send: ChallengeSender | null) => void;
  /**
   * Whether a host is actually mounted above this tree.
   *
   * False is a real state, not a failure: a thread rendered somewhere without
   * a host must draw the card WITHOUT a button rather than offer one that
   * cannot work.
   */
  available: boolean;
}

export const ChallengeContext = createContext<ChallengeSlot>({
  openChallenge: () => {},
  startNewChallenge: () => {},
  registerSender: () => {},
  available: false,
});

export function useChallengeSlot(): ChallengeSlot {
  return useContext(ChallengeContext);
}

/**
 * Both sides of every challenge in the open thread, keyed by seed.
 *
 * A card knows its own message and nothing else, so on its own it can only
 * ever say "beat this" — which is how a thread ends up showing a Beat it
 * button to somebody who already beat it. The thread has the whole list and
 * publishes the pairing here.
 *
 * Empty by default, so a card outside a thread simply shows the challenge
 * rather than breaking.
 */
export const ChallengeOutcomesContext = createContext<
  Map<string, ChallengeOutcome>
>(new Map());

/**
 * A Simon challenge as it appears in a thread.
 *
 * It REPLACES the message's text rather than sitting beside it. The raw
 * message is a sentence and a link — which is exactly what the words degrade
 * to when this does not render — so drawing both would say the same thing
 * twice.
 */
export function ChallengeCard({
  challenge,
  mine,
}: {
  challenge: SimonChallenge;
  mine: boolean;
}) {
  const { openChallenge, available } = useChallengeSlot();
  const outcomes = useContext(ChallengeOutcomesContext);
  const outcome = outcomes.get(challenge.seed) ?? { mine: null, theirs: null };
  const settled = isSettled(outcome);

  return (
    /*
      A SOLID DARK TILE, NOT A TINT.

      This card is drawn INSIDE a chat bubble, and the bubble is white when the
      message is yours and purple when it is theirs. A translucent surface with
      white ink therefore rendered white-on-white on the sender's own side —
      the card was there, correct and completely invisible, with only a green
      dot showing. So the tile carries its own opaque ground and does not
      inherit anything from the bubble behind it, which also makes a game read
      as a distinct object in the thread rather than as a coloured message.
    */
    <div className="min-w-0 rounded-2xl border border-white/15 bg-[#151518] p-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400"
        />
        <span className="text-[13px] font-semibold tracking-wide text-white/80">
          Simon
        </span>
      </div>

      {/* The score is the point of the card, so it is the biggest thing on it. */}
      {settled ? (
        /*
          BOTH HAVE PLAYED, SO THE CARD STATES A RESULT RATHER THAN REPEATING
          A CHALLENGE. Asking somebody to beat a score they have already beaten
          is the thread failing to notice its own history.
        */
        <>
          <div className="mt-2 flex items-baseline gap-4">
            <span className="text-[28px] font-bold leading-none tabular-nums text-white">
              {outcome.mine}
            </span>
            <span className="text-[13px] text-white/40">vs</span>
            <span className="text-[28px] font-bold leading-none tabular-nums text-white/70">
              {outcome.theirs}
            </span>
          </div>
          <p className="mt-1.5 text-[13px] font-semibold text-white/80">
            {outcome.mine === outcome.theirs
              ? "Draw"
              : (outcome.mine ?? 0) > (outcome.theirs ?? 0)
                ? "You won"
                : "They won"}
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-[28px] font-bold leading-none tabular-nums text-white">
            {challenge.score}
          </p>
          <p className="mt-1 text-[13px] text-white/55">
            {mine ? "your score — waiting for them" : "to beat"}
          </p>
        </>
      )}

      {/* No button on your own challenge: replaying your own seed would let you
          overwrite the very number your opponent is answering. */}
      {!mine && available && !settled && (
        <button
          type="button"
          onClick={() =>
            openChallenge({
              seed: challenge.seed,
              targetScore: challenge.score,
            })
          }
          className="ws-press mt-3 w-full rounded-full bg-white px-4 py-2.5 text-[14px] font-semibold text-black"
        >
          Beat it
        </button>
      )}
    </div>
  );
}
