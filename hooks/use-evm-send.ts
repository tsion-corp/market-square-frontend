"use client";

import { useCallback } from "react";
import { useSocialWallet } from "decane-connect-kit";
import type { EIP1193Provider, SignedAuthorization } from "viem";
import { DEMO_AUTH } from "@/lib/auth-mode";
import { sendSponsoredEvmCalls, type SignAuthorization } from "@/lib/trade/sponsor";
import { getSponsoredEvmChainById } from "@/lib/trade/sponsored-evm";
import { isReceiptChain, publicClientForChain } from "@/lib/trade/receipt";
import { receiptOutcome, type TxOutcome } from "@/lib/tx-receipt";
import { askToProtectWallet } from "@/lib/decane-recovery";
import { ensureWalletProtected, SQUARE_WALLET_PROTECTION } from "@/lib/wallet-protection";

/**
 * The ONE path by which anything leaves a reader's wallet.
 *
 * Every payment in Market Square — the USDC that funds a `$TICKER` buy, the
 * USDC that buys KASH — is signed here, by the reader, from their own embedded
 * wallet. The platform never holds their keys and never spends on their behalf
 * (ADR-0005, and `docs/PAYING_WITH_KASH.md`), so there is exactly one send and
 * it is this.
 *
 * ── GAS IS SPONSORED, THE SAME WAY IT IS IN wsws ───────────────────────────
 * A send on Base costs gas in ETH, and an embedded wallet funded with USDC
 * alone has none — so an unsponsored flow would fail for precisely the readers
 * it is built for. This is wsws's own stack, ported rather than reinvented:
 * the embedded EOA is upgraded in place via EIP-7702 to the shared Simple
 * Account implementation, the userOperation goes to Alchemy's bundler behind
 * our own proxy, and their Bundler Sponsored Operations policy pays the gas.
 *
 * "Upgraded in place" is the part that matters for money: the delegation is at
 * the SAME address, so sponsorship never creates or migrates funds into a
 * separate smart-wallet address. The balance the reader can see is the balance
 * that pays.
 *
 * Both apps share one Decane identity, so a reader's embedded wallet is the same
 * wallet in both — and now it is gas-sponsored in both, on the same policy.
 */
export interface EvmSendInput {
  to: `0x${string}`;
  data?: `0x${string}`;
  /** Native value in wei. Sponsorship covers gas only; this is still theirs. */
  value?: bigint;
  chainId: number;
}

export interface EvmSend {
  /** Signs and submits. Resolves with the hash once it is accepted. */
  send: (input: EvmSendInput) => Promise<`0x${string}`>;
  /**
   * Waits for the transaction to be MINED and reports what it did.
   *
   * Separate from `send` on purpose. The hash is what must be held for a retry
   * the moment it exists (see `lib/payment-hold.ts`) — if waiting were folded
   * into the send, a timeout while waiting would throw away the hash of a
   * payment that had already left the wallet, which is the exact double-charge
   * this whole flow is built to avoid.
   *
   * The read goes through a client PINNED TO THE TRANSACTION'S CHAIN
   * (`lib/trade/receipt.ts`), never the embedded wallet's ambient provider:
   * the wallet can leave that provider pointed at a different chain, so the receipt
   * would be polled where the transaction never happened and never found.
   *
   * Answers `pending` on a timeout rather than throwing: the transaction is not
   * lost, we merely stopped watching, and the caller still holds the hash.
   */
  waitForReceipt: (hash: `0x${string}`, chainId: number) => Promise<TxOutcome>;
  /** Signs an EIP-712 payload the backend built. Gasless — a prompt, not a send. */
  signTypedData: (owner: string, typedData: Record<string, unknown>) => Promise<string>;
}

type SocialWallet = ReturnType<typeof useSocialWallet>;

/**
 * Bridges Decane's 7702 authorization signer to the shape `sponsor.ts` expects.
 * Decane needs the nonce and chain id it signs for; the sponsor flow always
 * supplies them, so their absence is a programming error, not a state.
 */
function toSignAuthorization(wallet: SocialWallet): SignAuthorization {
  return async ({ contractAddress, chainId, nonce }) => {
    if (chainId === undefined || nonce === undefined) {
      throw new Error("7702 authorization needs an explicit chainId and nonce.");
    }
    const signed = await wallet.signAuthorization({ contractAddress, chainId, nonce });
    return signed as SignedAuthorization<number>;
  };
}

/**
 * Decane signs inside a TEE session that expires. An expired one prompts the
 * reader to unlock (passkey, PIN or unlock password) instead of failing the
 * payment; when even that cannot work the kit throws a sign-in-again error,
 * which surfaces as-is.
 */
async function ensureUnlocked(wallet: SocialWallet): Promise<void> {
  if (wallet.isUnlocked) return;
  await wallet.unlock();
}

function useDecaneEvmSend(): EvmSend {
  const wallet = useSocialWallet();

  const send = useCallback(
    async ({ to, data, value, chainId }: EvmSendInput): Promise<`0x${string}`> => {
      // A Decane session has exactly one EVM wallet, the only one this app
      // ever sends from.
      const address = wallet.addresses?.evm as `0x${string}` | undefined;
      if (!address) throw new Error("No wallet is connected.");
      // Device tier only: the first wallet action on this device is where the
      // passkey or password is asked for. In Square's identity tier this is a
      // no-op — see lib/wallet-protection. Before unlock, since a device with
      // nothing stored has nothing to unlock with.
      await ensureWalletProtected(wallet, askToProtectWallet, SQUARE_WALLET_PROTECTION);
      await ensureUnlocked(wallet);

      const sponsored = getSponsoredEvmChainById(chainId);
      if (sponsored) {
        const accessToken = wallet.getAccessToken();
        // The bundler proxy is session-gated, because it spends the platform's
        // paid Alchemy key and its gas policy.
        if (!accessToken) throw new Error("Your session expired. Sign in again.");
        const provider = wallet.getEthereumProvider({ chainId }) as unknown as EIP1193Provider;
        return sendSponsoredEvmCalls({
          chainId,
          address,
          provider,
          signAuthorization: toSignAuthorization(wallet),
          accessToken,
          calls: [{ to, data, value }],
        });
      }

      // Not a sponsored chain: an ordinary EOA send, where the reader pays
      // their own gas. Nothing in Market Square routes here today — every
      // payment is USDC on Base — but a chain leaving the registry must fail
      // by charging gas rather than by silently not sending.
      const hash = await wallet.sendTransaction({ chain: `evm:${chainId}`, to, data, value });
      return hash as `0x${string}`;
    },
    [wallet]
  );

  const waitForReceipt = useCallback(
    async (hash: `0x${string}`, chainId: number): Promise<TxOutcome> => {
      // The sponsored path already waited for the userOperation receipt, so
      // this is usually one immediate read that confirms it did not revert.
      if (!isReceiptChain(chainId)) return "pending";
      try {
        const receipt = await publicClientForChain(chainId).waitForTransactionReceipt({
          hash,
          timeout: 90_000,
          pollingInterval: 2_000,
        });
        return receiptOutcome({ status: receipt.status === "success" ? "0x1" : "0x0" });
      } catch {
        // Timed out, or the node could not be read. Neither is an answer about
        // the payment, and the caller still holds the hash.
        return "pending";
      }
    },
    []
  );

  const signTypedData = useCallback(
    async (owner: string, typedData: Record<string, unknown>): Promise<string> => {
      // Through the wallet's own provider, as wsws's desk signer does: the
      // payload arrives complete from the backend and is signed verbatim, so
      // nothing here can get the permit-domain subtleties wrong.
      const address = wallet.addresses?.evm;
      if (!address || address.toLowerCase() !== owner.toLowerCase()) {
        throw new Error("Signing wallet is not connected.");
      }
      await ensureUnlocked(wallet);
      const provider = wallet.getEthereumProvider() as unknown as EIP1193Provider;
      return (await provider.request({
        method: "eth_signTypedData_v4",
        params: [owner as `0x${string}`, JSON.stringify(typedData)],
      })) as string;
    },
    [wallet]
  );

  return { send, waitForReceipt, signTypedData };
}

/**
 * Demo mode mounts no Decane provider, so the hooks above would throw on render
 * rather than return nothing. Branching at MODULE level is the same shape
 * `useAuth` and `useEmbeddedWallet` use, and for the same reason: a conditional
 * hook call is a hooks-order violation, not a fallback.
 *
 * The functions REJECT rather than resolving with a fake hash. A demo that
 * handed back a plausible-looking transaction id would let every downstream
 * step report success on a payment that never existed, which is the one lie
 * this whole flow is built to make impossible.
 */
function useDemoEvmSend(): EvmSend {
  const refuse = useCallback(async (): Promise<never> => {
    throw new Error("There's no wallet in demo mode.");
  }, []);
  const pending = useCallback(async (): Promise<TxOutcome> => "pending", []);
  return { send: refuse, waitForReceipt: pending, signTypedData: refuse };
}

export const useEvmSend: () => EvmSend = DEMO_AUTH ? useDemoEvmSend : useDecaneEvmSend;
