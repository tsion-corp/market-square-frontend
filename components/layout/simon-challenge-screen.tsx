"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { SimonGame } from "@/features/games/components/simon-game";
import { reportScore } from "@/features/games/lib/report-score";
import { MAX_SIMON_SCORE } from "@/lib/game-challenge";
import { sq } from "@/lib/square-path";

/**
 * Playing a challenge from its link, outside any thread.
 *
 * ─── WHY IT CANNOT SEND A MESSAGE ───────────────────────────────────────────
 * There is no conversation here — the link may have been copied, opened in a
 * new tab, or followed from a notification. So the score is reported to
 * GameArena, where it counts exactly as it would from a thread, and the
 * player is pointed back at their chats rather than being offered a "send"
 * that has nowhere to go.
 *
 * ─── THE SEED IS VALIDATED, NOT TRUSTED ─────────────────────────────────────
 * It arrives from the address bar, so anyone can type one. That is harmless:
 * a seed is only an input to the sequence, and an unknown one is simply a
 * game nobody else has played. What must not happen is a malformed seed
 * reaching the engine, which throws on one — so it is checked here and a bad
 * link says so rather than rendering a crashed screen.
 */
const SEED_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function SimonChallengeScreen({
  seed,
  rawTarget,
}: {
  seed: string;
  rawTarget?: string;
}) {
  const router = useRouter();
  const [done, setDone] = useState<number | null>(null);

  const target = (() => {
    if (rawTarget === undefined) return undefined;
    const parsed = Number(rawTarget);
    // A score outside the game's range did not come from the game, so it is
    // dropped rather than shown as something to beat.
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_SIMON_SCORE
      ? parsed
      : undefined;
  })();

  const onFinished = useCallback((score: number) => {
    setDone(score);
    void reportScore(score);
  }, []);

  if (!SEED_PATTERN.test(seed)) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#0B0B0D] px-6 text-center">
        <p className="text-[17px] font-semibold text-white">
          That challenge link is broken
        </p>
        <p className="text-[14px] text-white/50">Ask them to send it again.</p>
        <a
          href={sq("/messages")}
          className="ws-press rounded-full bg-white px-5 py-2.5 text-[15px] font-semibold text-black"
        >
          Back to chats
        </a>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#0B0B0D]">
      <SimonGame
        seed={seed}
        targetScore={target}
        onFinished={onFinished}
        /*
          Closing goes to the inbox rather than back through history, because
          the page before this one may be another app entirely if the link was
          shared.

          Pushed through the router, never `location.assign`: a full load
          reloads the tab, and a reader with a gist room open would lose the
          room's audio just for closing a game. That is a rule this repo pins
          for every layout component, and it is pinned because it happened.
        */
        onClose={() => router.push(sq("/messages"))}
      />
      {/* Rendered for screen readers and for anyone whose game ended while the
          overlay was being dismissed — the score is the one thing that must
          not be lost. */}
      {done !== null && <p className="sr-only">You scored {done}.</p>}
    </main>
  );
}
