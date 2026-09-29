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
  // Three endpoints, as GameArena use: one flaky node otherwise makes every
  // name look unavailable and every verified player look unverified.
  transport: fallback([
    http("https://forno.celo.org"),
    http("https://rpc.ankr.com/celo"),
    http("https://1rpc.io/celo"),
  ]),
});

/** A chain read that hangs is worse than one that fails: the screen sits on a
    spinner with nothing to say. */
function withTimeout<T>(p: Promise<T>, ms = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("chain read timed out")), ms);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}

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
 * GoodDollar's Identity registry, read the way GameArena read it.
 *
 * ─── WHY NOT `isWhitelisted` ────────────────────────────────────────────────
 * Because it answers about ONE address. GoodDollar lets a wallet be linked to
 * a root identity, and `getWhitelistedRoot` resolves through that link — so a
 * person who verified on another of their wallets comes back verified. Asking
 * `isWhitelisted` about the linked wallet returns false and sends a genuinely
 * verified human through a face scan they have already passed.
 *
 * ─── WHY THE EXPIRY IS COMPUTED HERE ────────────────────────────────────────
 * `isWhitelisted` collapses "never verified" and "verified, then lapsed" into
 * one false. They are different things to say: the first is an invitation, the
 * second is "do it again", and telling somebody who verified last week that
 * they have never verified is how you lose them.
 *
 * The schedule is graduated and `authenticationPeriod()` is a TRAP — the
 * contract stores it as `unused_authenticationPeriod` and its getter returns
 * the LAST entry, so an authCount-0 wallet reads 180 days when it really has
 * three. Real expiry is:
 *
 *   status == 1 && daysSince(dateAuthenticated) < reverifyDaysOptions[authCount]
 *
 * On Celo that schedule is [3, 180]: a FIRST verification lapses after three
 * days and only a second buys 180. Wallets authenticated before the V4 upgrade
 * are grandfathered onto the last step.
 */
const GD_IDENTITY = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42" as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
/** 2026-03-05, the V4 upgrade point. */
const LEGACY_AUTHCOUNT_CUTOFF = 1772697574;
const DAY_MS = 24 * 3600 * 1000;

const GD_ABI = parseAbi([
  "function getWhitelistedRoot(address account) view returns (address)",
  "function identities(address) view returns (uint256 dateAuthenticated, uint256 dateAdded, string did, uint256 whitelistedOnChainId, uint8 status, uint32 authCount)",
  "function reverifyDaysOptions(uint256) view returns (uint32)",
]);

export interface Identity {
  /** Verified RIGHT NOW — inside the reverification window. */
  verified: boolean;
  /** Has been through the face check at some point, even if it has lapsed.
      This is the difference between an invitation and a reminder. */
  everVerified: boolean;
}

export async function readIdentity(address: `0x${string}`): Promise<Identity> {
  try {
    const root = (await withTimeout(
      celoRead.readContract({
        address: GD_IDENTITY,
        abi: GD_ABI,
        functionName: "getWhitelistedRoot",
        args: [address],
      }),
    )) as string;

    // A non-zero root IS the verified answer, link resolution included.
    if (root && root.toLowerCase() !== ZERO_ADDRESS) {
      return { verified: true, everVerified: true };
    }

    // Not currently whitelisted. Ask whether they ever were, so the invitation
    // can become a reminder rather than a denial of their own history.
    const identity = (await withTimeout(
      celoRead.readContract({
        address: GD_IDENTITY,
        abi: GD_ABI,
        functionName: "identities",
        args: [address],
      }),
    )) as readonly [bigint, bigint, string, bigint, number, number];

    const authedAt = Number(identity[0] ?? 0);
    const status = Number(identity[4] ?? 0);
    return { verified: false, everVerified: status === 1 || authedAt > 0 };
  } catch {
    /*
      A FAILED READ IS NOT "NOT VERIFIED". Saying so sends somebody who has
      already verified back through a face scan. Unknown is reported as not
      verified but never-verified false, so the screen invites rather than
      accuses, and a retry costs nothing.
    */
    return { verified: false, everVerified: false };
  }
}

export { LEGACY_AUTHCOUNT_CUTOFF, DAY_MS };
