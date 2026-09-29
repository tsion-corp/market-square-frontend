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

/**
 * Ask GameArena to fund this player's one Celo transaction.
 *
 * Nothing identifying is sent: the wallet is resolved from the session on our
 * server, because this call MOVES MONEY and a browser-named address would be a
 * drain dressed as an onboarding step.
 *
 * "already" is distinct from a refusal on purpose — it means the wallet has had
 * its one drip, so the gas may well be sitting there and the claim is worth
 * attempting rather than abandoning.
 */
/**
 * What came back from a request for gas, kept by NAME rather than collapsed.
 *
 * They mean different things to the player, and flattening them is how
 * somebody is told to try again when what they actually need is to verify.
 */
export type GasOutcome =
  /** Sent. The balance still has to land. */
  | "sent"
  /** Funded once before — the gas may already be spent. */
  | "already_claimed"
  /** Already holds enough; no drip needed, go straight to the claim. */
  | "not_fresh"
  /** The GoodDollar gate. Verifying is the way through, not retrying. */
  | "unverified"
  /** Their global daily kill-switch. Transient. */
  | "daily_cap"
  /** Their faucet wallet needs topping up. Ours to report, not to fix. */
  | "faucet_empty"
  /** Refused, unreachable, or not configured. */
  | "refused";

export interface GasRequest {
  funded: boolean;
  outcome: GasOutcome;
}

export async function requestGas(): Promise<GasRequest> {
  try {
    const response = await fetch(api("/api/gamearena/faucet"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    if (!response.ok) return { funded: false, outcome: "refused" };
    const body: unknown = await response.json().catch(() => null);
    const record = (body ?? {}) as Record<string, unknown>;
    const reason =
      typeof record.reason === "string" ? record.reason : "refused";
    return {
      funded: record.funded === true,
      outcome: (KNOWN_OUTCOMES.has(reason) ? reason : "refused") as GasOutcome,
    };
  } catch {
    return { funded: false, outcome: "refused" };
  }
}

/** An outcome we have not seen before is treated as a refusal rather than
    forwarded, so a new upstream string can never reach a player as copy. */
const KNOWN_OUTCOMES = new Set([
  "sent",
  "already_claimed",
  "not_fresh",
  "unverified",
  "daily_cap",
  "faucet_empty",
  "refused",
]);
