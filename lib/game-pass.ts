import { encodeFunctionData, parseAbi } from "viem";

/*
  THE PLAYER NAME, AS GAMEARENA'S CONTRACT DEFINES IT.

  The name is claimed on chain by minting a pass, and the contract is the only
  authority on what it will accept. Every rule below was read out of
  GamePass.sol rather than inferred from their UI, because a client that is
  more permissive than the contract produces a transaction that reverts after
  the player has paid attention, waited, and been told nothing useful.

  ─── TWO THINGS THE CONTRACT DOES THAT SURPRISE PEOPLE ──────────────────────
  Its revert string reads "Invalid username (3-16 chars, a-z 0-9 _)", but
  `_validUsername` accepts 0x41-0x5A as well — UPPERCASE IS ALLOWED. Anyone
  implementing from the error message would reject names the chain would have
  taken.

  And uniqueness is case-INSENSITIVE: `_usernameTaken` is keyed on `_lower(s)`,
  while `usernameOf` keeps the capitals the player typed. So "OgazBoiz" and
  "ogazboiz" are the same claim, and a checker that compares as typed would
  tell somebody a taken name is free.
*/

/** Celo mainnet, where the pass lives. Square itself is on Base; this is the
    only thing it does anywhere else. */
export const CELO_CHAIN_ID = 42220;

/** The GamePass contract. Overridable for a test deployment, the same way
    their backend reads GAME_PASS_ADDRESS. */
export const GAME_PASS_ADDRESS = (process.env.NEXT_PUBLIC_GAME_PASS_ADDRESS ??
  "0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE") as `0x${string}`;

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;

/** Digits, BOTH cases, and underscore — 0x30-0x39, 0x41-0x5A, 0x61-0x7A, 0x5F. */
const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;

export type NameProblem = "empty" | "too-short" | "too-long" | "bad-characters";

/**
 * Why a name cannot be claimed, or null if it can.
 *
 * Reports the FIRST problem rather than a list, because the field is corrected
 * one keystroke at a time and a stack of complaints about a half-typed name
 * reads as hostility.
 *
 * Note it says nothing about whether the name is taken: that is a question for
 * the chain, and answering it here would mean guessing.
 */
export function nameProblem(raw: string): NameProblem | null {
  if (!raw) return "empty";
  // The contract counts BYTES. The charset is ASCII-only, so for any name it
  // would accept, bytes and characters agree — but an emoji is caught here by
  // the charset rule rather than by a length that silently means something
  // different to each side.
  if (!USERNAME_PATTERN.test(raw)) return "bad-characters";
  if (raw.length < USERNAME_MIN) return "too-short";
  if (raw.length > USERNAME_MAX) return "too-long";
  return null;
}

/** What to say about it, in the player's language and never the chain's. */
export function nameProblemMessage(problem: NameProblem): string {
  switch (problem) {
    case "empty":
      return "Pick a name.";
    case "too-short":
      return `At least ${USERNAME_MIN} characters.`;
    case "too-long":
      return `At most ${USERNAME_MAX} characters.`;
    case "bad-characters":
      return "Letters, numbers and _ only.";
  }
}

/**
 * Clean what somebody typed into something claimable.
 *
 * Applied as they type, so the field cannot hold a name the chain would
 * refuse — the same shaping their own signup does. Trimming to the cap here is
 * what stops a long paste being silently truncated later into a different name
 * than the one they read back.
 */
export function sanitiseName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, "").slice(0, USERNAME_MAX);
}

/**
 * The form a name is COMPARED in.
 *
 * Uniqueness is case-insensitive on chain, so this is what must be used to ask
 * whether a name is taken, and never the version the player typed.
 */
export function nameKey(raw: string): string {
  return raw.toLowerCase();
}

/** Whether two names are the same claim as far as the contract is concerned. */
export function isSameName(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b);
}

/**
 * The pass contract's surface, as far as Square uses it.
 *
 * Kept here beside the name rules rather than next to the network client,
 * because building the claim transaction is pure — and the test runner covers
 * lib/ and nothing else, so logic that lives elsewhere is logic nothing tests.
 */
export const GAME_PASS_ABI = parseAbi([
  "function hasMinted(address player) external view returns (bool)",
  "function usernameOf(address player) external view returns (string)",
  "function isUsernameAvailable(string username) external view returns (bool)",
  "function mint(string username) external",
]);

/**
 * The transaction that claims a name.
 *
 * `mint(string)` is msg.sender-based, so the pass belongs to whoever signs
 * this — nobody can mint it on a player's behalf, which is why GameArena funds
 * the gas rather than minting for them.
 *
 * It refuses to BUILD a transaction the contract would reject. A revert costs
 * the player gas, arrives after they have waited and watched, and tells them
 * nothing they can act on.
 */
export function mintCall(name: string): {
  to: `0x${string}`;
  data: `0x${string}`;
  chainId: number;
} {
  const problem = nameProblem(name);
  if (problem) throw new RangeError(`not a claimable name: ${problem}`);
  return {
    to: GAME_PASS_ADDRESS,
    data: encodeFunctionData({
      abi: GAME_PASS_ABI,
      functionName: "mint",
      args: [name],
    }),
    chainId: CELO_CHAIN_ID,
  };
}
