"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ChallengeContext,
  type ChallengeSender,
} from "@/components/ui/challenge-slot";
import { SimonGame } from "@/features/games/components/simon-game";
import { reportScore } from "@/features/games/lib/report-score";
import { newSeed } from "@/lib/simon";

/**
 * Mounts the game overlay once, above a whole screen, and fills the challenge
 * slot the thread reads from.
 *
 * The overlay lives HERE rather than inside a card because a `fixed`
 * full-screen game rendered inside a scrolling message list would be created
 * and destroyed as the list virtualises — taking the round in progress with
 * it.
 *
 * A finished score reaches the chat through the sender the open thread
 * registered. That is deliberately the ONLY way a score leaves the game:
 * every score sent to the chat or to GameArena comes from a play session,
 * never from a number parsed out of a message, which anybody could type.
 */
export function ChallengeHost({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<{
    seed: string;
    targetScore?: number;
  } | null>(null);

  /*
    Whichever thread is currently open registers how a score becomes a
    message. A ref rather than state: re-rendering the whole screen because a
    thread registered a callback would be a render storm, and nothing here
    displays it.
  */
  const senderRef = useRef<ChallengeSender | null>(null);

  const openChallenge = useCallback(
    (args: { seed: string; targetScore?: number }) => setOpen(args),
    [],
  );
  const startNewChallenge = useCallback(() => setOpen({ seed: newSeed() }), []);
  const registerSender = useCallback((send: ChallengeSender | null) => {
    senderRef.current = send;
  }, []);

  const value = useMemo(
    () => ({
      openChallenge,
      startNewChallenge,
      registerSender,
      available: true,
    }),
    [openChallenge, startNewChallenge, registerSender],
  );

  return (
    <ChallengeContext.Provider value={value}>
      {children}
      {open && (
        <SimonGame
          // Keyed by seed, so answering a second challenge cannot resume the
          // first one's state and play a stale round against a different
          // sequence.
          key={open.seed}
          seed={open.seed}
          targetScore={open.targetScore}
          // Read at the moment the game ends, not captured when it opened:
          // if the reader navigated away mid-game there is no thread to send
          // to, and a stale callback would post into the wrong conversation.
          onFinished={(score) => {
            // The chat first: the card is what the player is waiting to see,
            // and the leaderboard write is neither instant nor theirs to
            // retry. Reported without awaiting so a slow upstream cannot hold
            // the game screen open.
            senderRef.current?.(open.seed, score);
            void reportScore(score);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </ChallengeContext.Provider>
  );
}
