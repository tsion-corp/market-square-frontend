import { api } from "@/lib/square-path";

/*
  SENDS A PLAYED SCORE TO GAMEARENA, AND NEVER GETS IN THE WAY.

  The score travels to our own BFF, which holds the partner key and resolves
  the player's wallet from their session. Nothing identifying is sent from
  here: a wallet in this body would be ignored upstream by design, because
  whoever names a wallet would otherwise be able to credit plays to it.

  EVERY FAILURE IS SWALLOWED. The player has finished their game and their
  card is already correct; a leaderboard write they cannot retry is not
  something to interrupt them with. An ad-blocker, an offline phone or a dead
  upstream must all end the same way — quietly.
*/

export interface ScoreReport {
  /** Whether GameArena recorded it at all. */
  reported: boolean;
  /**
   * Whether it became a TRANSACTION as well as a leaderboard row.
   *
   * False until that wallet holds a GamePass — upstream records every score
   * off-chain but can only mirror it on-chain for a player who has one. It is
   * passed through honestly so the UI can offer a pass, and must never be
   * presented as a transaction that happened.
   */
  onchain: boolean;
}

export async function reportScore(
  score: number,
  handle?: string,
): Promise<ScoreReport> {
  try {
    const response = await fetch(api("/api/gamearena/score"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(handle ? { score, handle } : { score }),
      cache: "no-store",
    });
    if (!response.ok) return { reported: false, onchain: false };
    const body: unknown = await response.json().catch(() => null);
    if (!body || typeof body !== "object")
      return { reported: false, onchain: false };
    const record = body as Record<string, unknown>;
    return {
      reported: record.reported === true,
      onchain: record.onchain === true,
    };
  } catch {
    return { reported: false, onchain: false };
  }
}
