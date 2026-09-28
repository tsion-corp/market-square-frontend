"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode } from "@/lib/api/envelope";
import { isTipRouteMissing } from "@/lib/tip-errors";
import {
  fetchReceivedTips,
  fetchTipCapability,
  reportTipTransfer,
  sendTip,
} from "@/features/tips/lib/api";
import { compareKashAmounts, KASH_TOKEN_DECIMALS } from "@/lib/kash-amount";
import { encodeErc20Transfer, toBaseUnits } from "@/lib/erc20";
import { encodeExecuteBatch, transferCallsForLegs } from "@/lib/account-batch";
import { holdKey } from "@/lib/payment-hold";
import { clearHeldPayment, heldPayment, holdPayment } from "@/lib/payment-store";
import { useEmbeddedWallet } from "@/hooks/use-wallet";
import { useEvmSend } from "@/hooks/use-evm-send";
import { useKashStatus } from "@/hooks/use-kash-status";
import { markTippingUnavailable, useTippingUnavailable } from "@/features/tips/lib/availability";
import type { Tip, TipTarget } from "@/features/tips/lib/types";

function isRouteMissing(error: unknown): boolean {
  return isTipRouteMissing(errorCode(error));
}

/**
 * The service's own tipping rules — and the read that nothing was making.
 *
 * `GET /tips/capability` publishes `{ enabled, minKash, maxKash,
 * verifiedAuthorsOnly }`, and the client shipped without ever asking. In
 * production the answer is min 1 KASH and verified authors only, while the
 * sheet defaulted to 0.05 and offered eight gift tiles under a whole KASH — so
 * the most natural tip a reader could send was refused by the server after
 * they had already confirmed it.
 *
 * Public and wallet-free, so one long-cached read serves every tip button on
 * screen. It is deliberately NOT retried into existence: a deployment without
 * the route answers 404, and `lib/tip-capability.ts` treats a missing
 * capability as permissive so a failed lookup can never take tipping down.
 */
export function useTipCapability() {
  return useQuery({
    queryKey: ["ms", "tips", "capability"],
    queryFn: fetchTipCapability,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
}

/** How far along a tip is, so the sheet can say which step is happening. */
export type TipPhase = "idle" | "creating" | "signing" | "confirming" | "reporting";

export interface SendTipInput {
  target: TipTarget;
  amountKash: string;
  /** The gift the sender chose, so the recipient can see what arrived. */
  giftId?: string | null;
  /**
   * WHO in the room is paid — stream gifts only. Absent means the host, which
   * is what every client that predates the field sends and must go on meaning.
   */
  toProfileId?: string | null;
  onPhase?: (phase: TipPhase) => void;
}

/**
 * Send one tip — including, where the service asks for it, actually paying.
 *
 * There is NO optimistic update here, on purpose. Every other mutation in the
 * app flips a boolean the user can see and rolls it back on failure; a tip
 * moves money, and an optimistic receipt is a claim that a payment happened.
 * The receipt is rendered from the SERVER's response — its `tipId`, its
 * `amountKash`, its `status` — or it is not rendered at all.
 *
 * ── TWO SETTLEMENTS ────────────────────────────────────────────────────────
 * On a rail that can transfer, `POST /tips` moves the money and comes back
 * confirmed; there is nothing else to do. On the real rail it cannot — the
 * kash rail exposes mint and burn and no transfer, and the platform is
 * non-custodial — so the response carries the author's WALLET instead, and the
 * sender's own wallet signs a KSH transfer to it. The tip stays PENDING until
 * kash's watcher sees that transfer on-chain, which is a genuine wait and is
 * reported as one.
 *
 * ── WHY THE HASH IS HELD ───────────────────────────────────────────────────
 * Between the transfer landing and the service being told about it, the sender
 * has paid and nothing records it. A retry there would create a second tip and
 * pay a second time. So the hash is written down the instant it exists
 * (`lib/payment-store.ts`), and a retry of the same attempt reports the held
 * payment instead of making another. The service's own one-in-flight guard
 * closes the loop: a retry that races it is told which tip is already open,
 * and the held hash is reported against THAT tip.
 */
export function useSendTip() {
  const queryClient = useQueryClient();
  const unavailable = useTippingUnavailable();
  const { address: wallet } = useEmbeddedWallet();
  const { send, waitForReceipt } = useEvmSend();
  const chain = useKashStatus().data?.chain ?? null;

  const mutation = useMutation<Tip, unknown, SendTipInput>({
    mutationFn: async ({ target, amountKash, giftId, toProfileId, onPhase }) => {
      const phase = onPhase ?? (() => {});
      /*
        THE RECIPIENT IS PART OF THE HOLD KEY, and it has to be.

        A hold remembers a payment this device already SIGNED but failed to
        report, so a retry reports it instead of charging again. The key was
        `tip:<kind>:<id>` plus the amount — which did not distinguish WHO was
        being paid, because until `toProfileId` a stream gift had exactly one
        possible recipient: the host.

        Now it does not. Two gifts of the same amount, in the same room, to
        DIFFERENT people would have collided on one key — and the recovery
        path would have reported a transfer signed for Ada against a tip
        created for Kola. That is money credited to the wrong person by the
        mechanism built to stop money being taken twice.

        Empty string for "the host", so every hold written before this field
        existed keeps its key and stays recoverable.
      */
      const key = holdKey(`tip:${target.kind}:${target.id}:${toProfileId ?? ""}`, amountKash);

      /**
       * A payment this attempt already made.
       *
       * Present only when a previous try transferred and then failed to report
       * it. Read before anything else, so the recovery path never starts by
       * creating a second tip.
       */
      const held = wallet && key ? heldPayment("tip", wallet, key) : null;

      phase("creating");
      let created;
      try {
        created = await sendTip(target, amountKash, giftId ?? null, toProfileId ?? null);
      } catch (error) {
        /**
         * The service already has a tip open for this post and sender — which
         * is exactly the state a failed report leaves behind. If we are
         * holding a payment for this attempt, it belongs to THAT tip: report
         * it rather than asking the sender to pay again.
         */
        const openTipId = (error as { details?: { tipId?: unknown } })?.details?.tipId;
        if (held?.ref && typeof openTipId === "string" && openTipId === held.ref) {
          phase("reporting");
          const reported = await reportTipTransfer(target, openTipId, held.txHash);
          if (wallet) clearHeldPayment("tip", wallet);
          return reported;
        }
        throw error;
      }

      // Rail settlement: the money moved server-side and the tip is done.
      if (!created.toWallet) return created.tip;

      // Client settlement: the sender pays, from their own wallet.
      if (!wallet) throw new Error("Sign in to send a tip.");
      if (!chain?.tokenAddress) {
        // Without the engine's own token address there is nothing to transfer
        // and guessing one sends real money into nothing.
        throw new Error("Tipping isn't configured on this environment yet.");
      }

      /*
        SIGN WHAT THE SENDER AGREED TO, NEVER WHAT CAME BACK.

        The request carries `amountKash` — the total the tray showed and the
        reader committed to. Everything below then signs
        `created.tip.amountKash`, which is the SERVICE'S ECHO of it, and
        nothing compared the two.

        `transferCallsForLegs` does check that the legs sum to the total, but
        the total it checks against is that same echo — so it proves the split
        is internally consistent and says nothing about whether it matches the
        amount anybody saw. A wrong or altered echo would be signed as readily
        as a right one.

        A signature is the last point at which the sender's agreement is still
        revocable. So an echo that is not the committed amount is refused here,
        before the wallet is ever asked — the same rule `lib/account-batch.ts`
        applies to the legs, applied one level up to the total they sum to.

        Compared in BASE UNITS, never as text: `0.5` and `0.50` are the same
        money and different strings, and refusing that pair would break a send
        that is exactly right.
      */
      if (compareKashAmounts(created.tip.amountKash, amountKash) !== 0) {
        throw new Error(
          `This gift came back priced at ${created.tip.amountKash} KASH, not the ${amountKash} you chose. Nothing was charged.`
        );
      }

      // A held hash is one this app produced, so it is already 0x-prefixed.
      let txHash = (held?.txHash ?? null) as `0x${string}` | null;
      /*
        The report, once it has been made inside the signing branch. Held so
        the tail below does not report a second time for the same tip — the
        service is idempotent on this, but a duplicate POST is still a lie
        about how many times we were told something.
      */
      let reportedTip: Awaited<ReturnType<typeof reportTipTransfer>> | null = null;
      /*
        THE HOLD MUST BELONG TO THIS TIP, and until now nobody checked.

        The hold key canonicalises the AMOUNT — `tip:<kind>:<id>:<toProfileId>`
        plus the amount — so two identical gifts (same gift, same person, same
        room) produce the SAME key. Reusing a held hash on `!txHash` alone
        therefore reported gift #1's transfer against gift #2's tip, and signed
        nothing: ONE PAYMENT, TWO TIPS. Worse, the two tips agree on amount and
        on both parties, so the reconciler has no way to notice — it would
        settle the second against a transfer that already paid for the first.

        The coin purchase has had this guard all along
        (`features/gifts/hooks/use-gifts.ts`: `!txHash || held?.ref !== purchase.id`).
        The tip path was the one that did not, and it is the path that can be
        fired repeatedly at the same person on purpose.

        A hold whose `ref` names a different tip is not ours to spend: sign
        again. That is correct even when it costs a second signature, because
        two gifts ARE two payments — the thing that must never happen is two
        gifts claiming one.
      */
      if (!txHash || held?.ref !== created.tip.tipId) {
        txHash = null;
        phase("signing");
        /*
          ONE TRANSACTION THAT PAYS THE CREATOR AND TAKES THE FEE.

          When the service names LEGS, the money is split — and it is paid as a
          single batched call from the sender's own account rather than as two
          transfers. Two transfers would mean the money RESTS at the platform
          in between, which is a float, a liability, a payout somebody has to
          sign, and a creator's earnings being a promise rather than a payment.
          ogazboiz: "it should go the remaining 50 percent to the reciever".

          The batch goes TO THE SENDER'S OWN ADDRESS: their embedded wallet is
          upgraded in place via EIP-7702 to the shared SimpleAccount, so
          `executeBatch` is a call on themselves. Same address, same balance,
          gas sponsored — see `use-evm-send`.

          ATOMIC IS THE POINT. Both legs land or neither does, so a half-paid
          gift is unreachable rather than merely unlikely.

          NO LEGS IS THE OLD PATH, unchanged: one transfer of the whole amount
          to `toWallet`. That is what every deployment does until the service
          ships the split, so absent is compatibility rather than an error.
        */
        const batched = created.legs
          ? transferCallsForLegs({
              token: chain.tokenAddress as `0x${string}`,
              legs: created.legs,
              totalKash: created.tip.amountKash,
              toBase: (amount) => toBaseUnits(amount, KASH_TOKEN_DECIMALS),
              encodeTransfer: encodeErc20Transfer,
            })
          : null;

        txHash = await send(
          batched
            ? {
                to: wallet as `0x${string}`,
                data: encodeExecuteBatch(batched),
                chainId: chain.chainId,
              }
            : {
                to: chain.tokenAddress as `0x${string}`,
                // The TOKEN's precision, not the API's — see KASH_TOKEN_DECIMALS.
                data: encodeErc20Transfer(
                  created.toWallet,
                  toBaseUnits(created.tip.amountKash, KASH_TOKEN_DECIMALS),
                ),
                chainId: chain.chainId,
              }
        );
        /**
         * Written BEFORE the confirmation wait. The transfer is already
         * broadcast; from here the only thing that makes a retry safe is that
         * this hash and the tip it belongs to were recorded first.
         */
        if (key) holdPayment("tip", wallet, { key, txHash, ref: created.tip.tipId });

        /*
          REPORTED BEFORE THE CONFIRMATION WAIT, AND THAT ORDER IS THE FIX.

          It used to run `waitForReceipt` first and report afterwards. The
          money has ALREADY moved by this point — `send` returns only once the
          userOperation receipt is in hand — so anything that threw between the
          two lines left the service with a tip whose `txHash` is NULL, for
          ever. The transfer is on-chain, the ledger reconciles it, and nothing
          on the service side can ever match it to a tip, because the tip has
          no hash to match on.

          A thrown wait is not exotic: a dropped connection, a closed tab, a
          slow RPC, a phone locking. The held payment in sessionStorage was the
          only recovery, and it only works if the SAME browser retries within
          the hour. Nobody retries a gift that looked like it worked.

          Reporting first costs nothing, because the service already treats
          this as a CLAIM rather than proof: it records the hash and settles
          nothing until kash's watcher observes the transfer independently and
          checks the amount and both wallets. So an early report cannot credit
          anybody, and a transfer that later turns out to have reverted is
          simply never observed — which `expireUnobservedPending` already
          handles, and which re-opens if the transfer does turn up.

          The wait stays, after, and is now purely for what the READER is told:
          a reverted transfer must still say so rather than reading as sent.
        */
        phase("reporting");
        reportedTip = await reportTipTransfer(target, created.tip.tipId, txHash);
        // The service owns the hash now; a retry must not re-report it.
        clearHeldPayment("tip", wallet);

        phase("confirming");
        const outcome = await waitForReceipt(txHash, chain.chainId);
        if (outcome === "reverted") {
          /*
            NOTHING IS UNDONE HERE, and that is deliberate. The report has
            already gone and it should stand: the service verifies on-chain and
            will never observe a reverted transfer, so the tip expires rather
            than crediting anybody. Retracting it would be the client asserting
            an outcome the service is better placed to judge.

            The reader is still told plainly, because a reverted transfer that
            reads as sent is the one thing this flow may not do.
          */
          throw new Error("The transfer failed on-chain. Nothing was sent.");
        }
      }

      phase("reporting");
      const reported = reportedTip ?? (await reportTipTransfer(target, created.tip.tipId, txHash));
      // Reported: the service owns it now and a retry must not re-report it.
      clearHeldPayment("tip", wallet);
      return reported;
    },
    onError: (error) => {
      // No toast: the sheet is open and owns the message. A toast here would
      // put the same failure on screen twice.
      if (isRouteMissing(error)) markTippingUnavailable();
    },
    onSuccess: (tip) => {
      // Narrow on purpose. A tip changes the RECIPIENT's profile (whatever
      // totals the service decides to show there) and nothing else we cache —
      // the post's own tallies do not carry tips, so sweeping the feed would
      // refetch every timeline on screen to change nothing.
      /*
        Only when the tip NAMED a profile. A gist room gift carries no
        `Profile` for its recipient (see `TipSchema.recipient`), and there is
        nothing to invalidate for somebody this response cannot name.
      */
      if (tip.recipient) {
        queryClient.invalidateQueries({ queryKey: ["ms", "profile", tip.recipient.username] });
      }
    },
  });

  return { ...mutation, unavailable };
}

export { useTippingUnavailable };

/**
 * The tips this reader has been PAID — the gift gallery's counts.
 *
 * `enabled` rather than an early return, because it is only ever asked on your
 * OWN profile: the route is `/me`, so on anybody else's there is no question
 * to ask and firing it would be a request whose answer is about the wrong
 * person.
 *
 * A missing route is not an error worth surfacing. Tipping shipped ahead of
 * the service more than once, so a 404 here means "not deployed" and the
 * gallery simply renders without counts — the same rule the Arkmark follows.
 */
export function useReceivedTips(enabled: boolean) {
  return useQuery({
    queryKey: ["ms", "tips", "received"],
    queryFn: fetchReceivedTips,
    enabled,
    staleTime: 60_000,
    retry: (count, error) => !isRouteMissing(error) && count < 2,
  });
}
