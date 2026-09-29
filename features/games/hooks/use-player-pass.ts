"use client";

import { useCallback, useEffect, useState } from "react";
import { useSocialWallet } from "decane-connect-kit";
import { toHex, type EIP1193Provider } from "viem";
import { useEvmSend } from "@/hooks/use-evm-send";
import { CELO_CHAIN_ID, mintCall } from "@/lib/game-pass";
import { buildFvLink, fvMessage } from "@/lib/gooddollar-link";
import {
  readPass,
  readIdentity,
  waitForMint,
} from "@/features/games/lib/pass-chain";

/*
  WHERE A PLAYER STANDS WITH GAMEARENA, AND THE TWO STEPS THAT MOVE THEM ON.

  Every score reaches GameArena's board the moment it is played. This hook is
  about the other half — becoming a player whose plays are also counted ON
  CHAIN, which needs a pass, and being a verified human, which needs
  GoodDollar.

  ─── THE TWO ARE INDEPENDENT, AND THE ORDER IS DELIBERATE ───────────────────
  `recordScore` checks only that a pass exists, never that anyone is verified —
  so the PASS is what makes plays count, and verification is the human layer
  over it. Verification still goes first, because GameArena gates the gas that
  funds the claim on being verified, and a face scan needs no gas. Free step,
  then funded step; there is no order in which a player is stuck.

  ─── NOTHING HERE IS EVER CACHED ────────────────────────────────────────────
  A first GoodDollar verification lapses after THREE DAYS. Remembering
  "verified" across a session is precisely the bug their own players reported:
  verified once, told days later they were not. It is read again, every time.
*/

export interface PlayerPass {
  loading: boolean;
  /** False when the integration is off or the reader has no wallet. Render
      nothing rather than offer a step that cannot complete. */
  available: boolean;
  hasPass: boolean;
  username: string | null;
  /** Verified right now — inside GoodDollar's reverification window. */
  verified: boolean;
  /**
   * Has been through the face check before, even if it has lapsed.
   *
   * The difference matters in words: somebody who verified last week and fell
   * out of a three-day window should be asked to do it AGAIN, not told they
   * have never done it.
   */
  everVerified: boolean;
}

const UNAVAILABLE: PlayerPass = {
  loading: false,
  available: false,
  hasPass: false,
  username: null,
  verified: false,
  everVerified: false,
};

/**
 * Read where the player stands, straight from Celo.
 *
 * ─── WHY THIS DOES NOT ASK OUR SERVER ───────────────────────────────────────
 * It used to, through a BFF route that resolved the wallet from the session
 * and asked GameArena. Every one of those hops is a way to fail while the
 * ANSWER sits in public state on a chain the browser can already read: the
 * pass and its name are on GamePass, and verification is GoodDollar's
 * `isWhitelisted`. In practice the session's wallet lookup failed locally and
 * the whole step reported itself unavailable, with a working chain, a working
 * partner API and a correct key.
 *
 * So the gating question — has this wallet a pass, what name is on it, is this
 * a verified human right now — is answered by reading the chain. The partner
 * API is still where SCORES go, because a write has to be attributed to a
 * session rather than to an address a browser named.
 *
 * Nothing is remembered: `isWhitelisted` encodes a reverification window that
 * is three days on a first verification, so a cached answer is wrong within
 * days.
 */
async function loadPlayerPass(address: `0x${string}`): Promise<PlayerPass> {
  const [pass, identity] = await Promise.all([
    readPass(address),
    readIdentity(address),
  ]);
  return {
    loading: false,
    available: true,
    hasPass: pass.hasPass,
    username: pass.username,
    verified: identity.verified,
    everVerified: identity.everVerified,
  };
}

export function usePlayerPass() {
  const wallet = useSocialWallet();
  const { send } = useEvmSend();
  const [state, setState] = useState<PlayerPass>({
    ...UNAVAILABLE,
    loading: true,
  });

  const address = wallet.addresses?.evm as `0x${string}` | undefined;

  const refresh = useCallback(
    () =>
      address ? loadPlayerPass(address).then(setState) : Promise.resolve(),
    [address],
  );

  /*
    The fetch is a plain function that RETURNS the next state rather than
    setting it, and the effect applies the result once it resolves. Calling a
    setState-ing helper straight from an effect body reads as a synchronous
    update to both React's lint rule and to anyone skimming it; this way the
    loading is ordinary data-fetching and the only writer is the continuation.
  */
  useEffect(() => {
    // No wallet is a real state, not a failure — there is no address to ask
    // about. It is DERIVED at the return below rather than written into state
    // here, because setting state straight from an effect body is a cascading
    // render, and the answer is already a pure function of `address`.
    if (!address) return;
    let cancelled = false;
    void loadPlayerPass(address).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  /**
   * Send the player to GoodDollar, and arrange for them to come back.
   *
   * The signature proves they control the address being verified — GoodDollar
   * recovers it from the exact message in `fvMessage`.
   *
   * SAME-TAB, always. GameArena learned this the hard way: on mobile and
   * in-wallet browsers a popup is blocked or stranded, the scan passes in a
   * window that never returns, and the on-chain whitelisting is never
   * finalised — so the player is told they are verified and then told days
   * later that they are not. Square is almost entirely mobile, so it always
   * redirects and GoodDollar returns them to `returnTo`.
   *
   * This leaves the page, unavoidably: GoodDollar's flow is on their origin.
   * Anyone in a gist room drops out of it, exactly as they would on
   * GameArena's own site.
   */
  const startVerification = useCallback(
    async (returnTo: string): Promise<{ ok: boolean; error?: string }> => {
      const address = wallet.addresses?.evm as `0x${string}` | undefined;
      if (!address) return { ok: false, error: "No wallet is connected." };
      try {
        const provider =
          wallet.getEthereumProvider() as unknown as EIP1193Provider;
        /*
          THE MESSAGE IS HEX-ENCODED, AND THAT IS NOT A FORMALITY.

          `personal_sign` takes its message as a HEX string. Passing the raw
          text with only a TypeScript cast to satisfy the type compiles, runs,
          returns a signature — and signs something other than GoodDollar's
          message, so their server recovers a different address, or none. It
          surfaces at the very end as their own "Login information is missing"
          screen, with nothing on our side having reported an error.

          viem's signMessage does this encoding internally, which is why
          GameArena's SDK path never had to think about it; calling the
          provider directly makes it ours to do.
        */
        const fvsig = (await provider.request({
          method: "personal_sign",
          params: [toHex(fvMessage(address)), address],
        })) as string;

        /*
          A signature is 65 bytes — 0x plus 130 hex characters. Anything else
          means the wallet handed back something that cannot be recovered from,
          and sending it onward just moves the failure to GoodDollar's screen
          where we can neither see it nor explain it.
        */
        if (typeof fvsig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(fvsig)) {
          return {
            ok: false,
            error: "Your wallet couldn't sign that. Try again.",
          };
        }
        window.location.assign(
          buildFvLink({
            address,
            fvsig,
            chainId: CELO_CHAIN_ID,
            callbackUrl: returnTo,
          }),
        );
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not start verification.",
        };
      }
    },
    [wallet],
  );

  /**
   * Claim a name by minting the pass.
   *
   * The player signs it themselves because `mint(string)` is msg.sender-based
   * — the pass belongs to whoever sends it and nobody can mint one on their
   * behalf. Gas is GameArena's to fund; Square never pays for Celo.
   */
  const claimName = useCallback(
    async (name: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const hash = await send(mintCall(name));
        if ((await waitForMint(hash)) !== "claimed") {
          return {
            ok: false,
            error: "That didn't go through. Try again in a moment.",
          };
        }
        await refresh();
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The reverts a player can actually cause, said in their words rather
        // than the contract's.
        if (/username taken/i.test(message)) {
          return { ok: false, error: "That name just went. Pick another." };
        }
        if (/already minted/i.test(message)) {
          await refresh();
          return { ok: false, error: "You already have a name." };
        }
        if (/insufficient funds/i.test(message)) {
          return {
            ok: false,
            error: "Couldn't claim it yet — try again shortly.",
          };
        }
        return { ok: false, error: "Couldn't claim that name. Try again." };
      }
    },
    [send, refresh],
  );

  // Derived, not stored: with no wallet there is nothing to offer, and that
  // conclusion should not be able to go stale in state.
  const resolved = address ? state : UNAVAILABLE;

  return { ...resolved, refresh, startVerification, claimName };
}
