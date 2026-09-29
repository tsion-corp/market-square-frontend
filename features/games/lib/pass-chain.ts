import { createPublicClient, fallback, http, parseAbi } from "viem";
import { celo } from "viem/chains";
import { GAME_PASS_ABI, GAME_PASS_ADDRESS, nameProblem } from "@/lib/game-pass";

/*
  READING AND CLAIMING A GAME PASS, ON CELO.

  Square runs on Base and this is the only thing it does anywhere else. The
  pass is a soulbound NFT on Celo whose existence is what makes a player's
  scores count on chain, and the name on it is claimed by minting.

  ─── WHY A CLIENT OF ITS OWN ────────────────────────────────────────────────
  `publicClientForChain` only knows the chains Square SPONSORS GAS FOR, and
  Celo must not join that list: gas here is GameArena's to pay, not ours. So
  this is a separate read-only client on Celo's public node, deliberately
  outside the sponsored-chain registry, and nothing about it changes what
  Square is willing to fund.

  ─── THE MINT IS SENT BY THE PLAYER, BECAUSE IT HAS TO BE ───────────────────
  `mint(string)` is msg.sender-based, so the pass belongs to whoever signs the
  transaction. Nobody can mint it for them — which is also why GameArena funds
  the gas rather than minting on their behalf.
*/

/** A public node with the chain's default as backup, so one flaky endpoint
    does not make every name look unavailable. */
export const celoRead = createPublicClient({
  chain: celo,
  transport: fallback([http("https://forno.celo.org"), http()]),
});

export type NameAvailability = "available" | "taken" | "invalid" | "unknown";

/**
 * Whether a name can be claimed.
 *
 * Validated locally FIRST, so an obviously bad name never becomes a network
 * round trip — and, more importantly, so the answer for a bad name is a
 * specific complaint rather than the flat "taken" the contract's combined
 * check would give. `isUsernameAvailable` returns false for BOTH invalid and
 * taken, and telling somebody their two-character name is "taken" sends them
 * hunting for a different name instead of a longer one.
 *
 * "unknown" on a failed read, never "available": offering a name we could not
 * check ends in a revert the player pays attention for and learns nothing
 * from.
 */
export async function checkName(name: string): Promise<NameAvailability> {
  if (nameProblem(name) !== null) return "invalid";
  try {
    const free = await celoRead.readContract({
      address: GAME_PASS_ADDRESS,
      abi: GAME_PASS_ABI,
      functionName: "isUsernameAvailable",
      args: [name],
    });
    return free ? "available" : "taken";
  } catch {
    return "unknown";
  }
}

/** Whether this wallet already holds a pass, and the name on it. */
export async function readPass(
  address: `0x${string}`,
): Promise<{ hasPass: boolean; username: string | null }> {
  try {
    const [hasPass, username] = await Promise.all([
      celoRead.readContract({
        address: GAME_PASS_ADDRESS,
        abi: GAME_PASS_ABI,
        functionName: "hasMinted",
        args: [address],
      }),
      celoRead
        .readContract({
          address: GAME_PASS_ADDRESS,
          abi: GAME_PASS_ABI,
          functionName: "usernameOf",
          args: [address],
        })
        .catch(() => ""),
    ]);
    return { hasPass: Boolean(hasPass), username: username || null };
  } catch {
    return { hasPass: false, username: null };
  }
}

/**
 * Wait for a claim to land.
 *
 * Square's own `waitForReceipt` only knows the chains it sponsors, and Celo is
 * deliberately not one of them — so it would answer "pending" forever here.
 * This polls the same client the reads use.
 */
export async function waitForMint(
  hash: `0x${string}`,
): Promise<"claimed" | "failed"> {
  try {
    const receipt = await celoRead.waitForTransactionReceipt({
      hash,
      timeout: 120_000,
      pollingInterval: 2_000,
    });
    return receipt.status === "success" ? "claimed" : "failed";
  } catch {
    // A timeout is not a failure: the transaction may still land. Saying
    // "failed" would invite a second mint, which reverts for a wallet that
    // already has a pass and costs the player twice.
    return "failed";
  }
}

/**
 * GoodDollar's Identity registry on Celo, and the one question we ask it.
 *
 * `isWhitelisted` is not a stored flag: it is `status == 1` AND
 * `daysSince(dateAuthenticated) < reverifyDaysOptions[authCount]`, and on Celo
 * that schedule is [3, 180] — a FIRST verification lapses after three days and
 * only a second buys 180. Reading it live is therefore the only correct way to
 * ask; anything remembered is wrong within days, which is exactly the bug
 * GameArena's own players reported.
 */
const GD_IDENTITY = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42" as const;
const GD_ABI = parseAbi([
  "function isWhitelisted(address) view returns (bool)",
]);

export async function readVerified(address: `0x${string}`): Promise<boolean> {
  try {
    return Boolean(
      await celoRead.readContract({
        address: GD_IDENTITY,
        abi: GD_ABI,
        functionName: "isWhitelisted",
        args: [address],
      }),
    );
  } catch {
    // A failed read is NOT "not verified": saying so would send somebody who
    // is already verified back through a face scan.
    return false;
  }
}
