"use client";

import { z } from "zod";
import { msApi } from "@/lib/api/service";
import { ProfileSchema, TipCapabilitySchema } from "@/lib/api/schemas";
import { TipSchema, type Tip, type TipTarget } from "@/features/tips/lib/types";

/**
 * Whether tipping works on this deployment, and the amounts it accepts.
 *
 * Public upstream, so a signed-out reader gets the same answer and the
 * sign-in prompt arrives when they choose to pay rather than when they look.
 */
export async function fetchTipCapability() {
  return TipCapabilitySchema.parse(await msApi.get("/tips/capability"));
}

/**
 * THE TIPS THIS PERSON HAS BEEN PAID — `GET /me/tips/received`.
 *
 * The service's own summary for it is "the caller's confirmed tips received
 * (earnings)", and `/me` is the whole scope: there is no route that answers
 * what SOMEBODY ELSE has been paid, and there should not be — another
 * person's income is not a fact their profile publishes.
 *
 * Parsed as the service's row (`Tip` in the served spec), not the receipt
 * shape the rest of this slice renders: this is a list of ledger entries, and
 * nothing here is hydrated with a profile. `amountKash` stays a string.
 *
 * `limit` is the only parameter the route takes — no cursor, so this is a
 * recent-window read rather than a pageable history. 100 is the most the
 * route accepts (`tipsReceivedQuerySchema`, max 100): asking for 200 was a
 * 400 on every profile visit — VALIDATION_ERROR, "Too big: expected number
 * to be <=100" — which the gallery read as "no counts", silently. It is not
 * a claim to have every tip ever.
 */
/**
 * WHERE A TIP CAME FROM — `source` on `TipWithContext`.
 *
 * `kind` separates a gist ROOM from a broadcast STREAM, and the service draws
 * that distinction deliberately so the client does not have to infer it: a
 * gist room is a stream with category 'house', and "during a gist room" and
 * "on a broadcast" are different sentences about somebody's money.
 *
 * `title` is nullable in three real ways, none of them a gap: a post has no
 * title field so its title is its own opening TEXT (a picture-only post has
 * none), a room with no topic set has none, and `source` itself is null when
 * the tip was aimed at a PERSON rather than at a thing. Absent means the row
 * shows no source line — never an invented one.
 *
 * Titles arrive truncated to 140 characters server-side with an ellipsis
 * already applied, so nothing here clamps them again expecting full text.
 */
const TipSourceSchema = z.object({
  kind: z.enum(["post", "stream", "room"]).catch("post"),
  id: z.string().nullable().optional().default(null),
  title: z.string().nullable().optional().default(null),
});

const ReceivedTipSchema = z.object({
  id: z.string(),
  /**
   * The sender, hydrated by the service — `ProfileSummary`, which carries the
   * three fields `ProfileSchema` actually requires, so this is the app's one
   * profile shape rather than a second one.
   *
   * NULLABLE ON PURPOSE: a tip outlives the account that sent it, because the
   * money moved. A null sender keeps the amount and the gift and names nobody.
   *
   * Optional as well as nullable because the field is NOT on the running
   * service yet — it is committed on the backend and not deployed to :8094 —
   * so today every tip parses without it and the row renders exactly as it
   * did before.
   */
  fromUser: ProfileSchema.nullable().optional().default(null),
  source: TipSourceSchema.nullable().optional().default(null),
  amountKash: z.string(),
  /**
   * WHAT THE RECEIVER WAS ACTUALLY CREDITED, which is not always what was sent.
   *
   * `amountKash` is the FACE VALUE — the lion the room watched fly, 1 KASH —
   * and it stays the face value on purpose: quietly reducing it would make the
   * sender's view and the receiver's view of the same event disagree with no
   * way to reconcile them. `creditedKash` is the other number: 0.5 KASH after
   * Square's cut on a gift.
   *
   * ON A PLAIN TIP THEY ARE EQUAL. There is no split on a tip — verified on
   * the service's own ledger pair, which writes the SAME `amountKash` variable
   * to both the sender's debit and the author's credit — so this needs no
   * branch on kind and no percentage in the client.
   *
   * NULLABLE **AND** OPTIONAL, AND THE TWO ARE DIFFERENT ANSWERS:
   *   absent  — this deployment has no split at all, the field does not exist
   *   null    — nothing was withheld on THIS payment: every tip ever settled,
   *             and every gift sent before the split existed
   *   a value — what the recipient was credited
   *
   * `.optional()` ALONE WOULD HAVE THROWN. The service's column is
   * `string | null` and a tip is always null there, so the first response
   * carrying the field would have failed the whole list parse and taken the
   * earnings screen down — not a silent empty this time, a hard error, on the
   * day a deploy touched nothing in this repo.
   *
   * No default under either, so the fallback to `amountKash` is CORRECT rather
   * than merely safe: where nothing was withheld, the face value IS the
   * credit.
   *
   * THE PERCENTAGE DELIBERATELY DOES NOT LIVE HERE. The split is configurable
   * server-side and applies only to gifts; handed the rate instead of the
   * result, this screen would go wrong the day somebody changed it. Same
   * argument as gift prices, pointed at earnings.
   */
  creditedKash: z.string().nullable().optional(),
  // Same `catch` reasoning as `TipResponseSchema`: an unknown status must not
  // fail a list, and it degrades to the one that asserts nothing.
  status: z.enum(["pending", "confirmed", "failed"]).catch("pending"),
  giftId: z.string().nullable().optional().default(null),
  fromUserId: z.string().nullable().optional().default(null),
  createdAt: z.string().nullable().optional().default(null),
});

const ReceivedTipsSchema = z.object({
  items: z.array(ReceivedTipSchema).optional().default([]),
});

export type ReceivedTip = z.infer<typeof ReceivedTipSchema>;

export async function fetchReceivedTips(): Promise<ReceivedTip[]> {
  const page = ReceivedTipsSchema.parse(
    /*
      100 IS THE SERVICE'S CEILING, NOT A PREFERENCE.

      This asked for 200 and got a 400 back on every load:

        {"code":"VALIDATION_ERROR","details":[
          {"path":"limit","message":"Too big: expected number to be <=100"}]}

      So the earnings list has been empty for everybody with a tip — not
      because they have none, but because the request was refused before it
      could answer. A number chosen to mean "plenty" turned into a hard
      failure, and it failed the same way every time rather than degrading.

      Asking for the maximum the service accepts is the honest ceiling. If
      somebody ever passes 100 received tips this needs the cursor the route
      already offers, not a bigger number — there is no bigger number.
    */
    await msApi.authedGet("/me/tips/received", { limit: 100 })
  );
  return page.items;
}

/**
 * The service answers with its OWN tip row — ids, both party ids, a rail
 * reference — not with the receipt shape this slice renders. Adapting here
 * keeps the boundary in one place: components stay written against `Tip`, and
 * the response is parsed before anything reads it.
 *
 * Two mappings are deliberate:
 *
 *  - `confirmed` becomes `settled`. They are the same event under two names,
 *    and letting the unknown-status `catch` swallow it would show "pending" on
 *    a payment that has already completed.
 *  - `recipient` comes from the TARGET, because the service does not hydrate a
 *    profile onto a tip. It is the author whose post the user chose to tip, so
 *    it is the same person either way — but it is OUR value, not the server's,
 *    and it must never be used to assert that the money arrived. Only `status`
 *    says that.
 */
/**
 * What `POST /posts/:id/tips` actually answers with — the service's own tip
 * row. Parsed strictly before anything reads it; `amountKash` stays a string.
 */
const TipResponseSchema = z.object({
  id: z.string(),
  amountKash: z.string(),
  status: z.enum(["pending", "confirmed", "failed"]).catch("pending"),
  giftId: z.string().nullable().optional().default(null),
  /**
   * The wallet to pay, present only when the SENDER must settle this tip.
   *
   * Its presence is the instruction: no wallet means the service moved the
   * money and the tip is already confirmed; a wallet means nothing has moved
   * and the sender's own wallet has to sign a KSH transfer to it. The kash
   * rail cannot pay a third party — it exposes mint and burn and no transfer,
   * and the platform is non-custodial — so this is how a real tip settles.
   */
  toWallet: z.string().optional(),
  /**
   * HOW THIS PAYMENT IS SPLIT, when it is.
   *
   * A LIST WITH ROLES, not two named fields, and the service chose that shape
   * for a reason worth keeping: the split is configurable, so at a 100% share
   * the platform leg VANISHES rather than arriving as a zero — and a list lets
   * a third leg exist later without changing anything here.
   *
   * Absent means the old single transfer: pay `toWallet` the whole amount.
   * That is what every deployment does until the service names the legs, so
   * absent is the compatibility path rather than an error.
   */
  settlement: z
    .object({
      kind: z.literal("split"),
      legs: z
        .array(
          z.object({
            role: z.string(),
            toWallet: z.string(),
            amountKash: z.string(),
          })
        )
        .min(1),
    })
    .optional(),
});

/** One destination of a split payment, as the service named it. */
export interface SettlementLeg {
  role: string;
  toWallet: string;
  amountKash: string;
}

function adopt(raw: unknown, target: TipTarget): Tip {
  const parsed = TipResponseSchema.parse(raw);
  return TipSchema.parse({
    tipId: parsed.id,
    amountKash: parsed.amountKash,
    recipient: target.recipient,
    status: parsed.status === "confirmed" ? "settled" : parsed.status,
    giftId: parsed.giftId,
  });
}

/** A created tip, plus what the sender must pay to settle it. */
export interface CreatedTip {
  tip: Tip;
  toWallet: string | null;
  /**
   * The legs of a split payment, when the service named them.
   *
   * Null is the single-transfer path — pay `toWallet` the whole amount — which
   * is what happens on any deployment that has not shipped the split yet.
   */
  legs: SettlementLeg[] | null;
}

export async function sendTip(
  target: TipTarget,
  amountKash: string,
  /** The gift chosen, if one was. A label the service records, never a price. */
  giftId: string | null = null,
  /**
   * WHO IS PAID, on a stream gift — anybody in the room, not just its host.
   *
   * ABSENT keeps the service's original behaviour exactly: the host is paid,
   * because `recipientId` was hardcoded to `stream.ownerId`. So an older
   * client and a service that has never heard of this field both go on working
   * and nothing needed a coordinated deploy.
   *
   * SEND IT FOR EVERY ROW INCLUDING THE HOST. The service exempts the host
   * from the presence check — a host whose own heartbeat has lapsed is still
   * the host — so naming them explicitly behaves identically to omitting the
   * field. That is deliberate on their side so a picker does not have to
   * special-case its first row into the no-field form, and a picker that did
   * would be carrying a second code path for no gain.
   *
   * POST AND PROFILE TIPS IGNORE IT. Those routes have their own recipient by
   * construction — the post's author, the profile itself — so passing it there
   * would be inventing a parameter the service does not read.
   */
  toProfileId: string | null = null,
): Promise<CreatedTip> {
  /**
   * Each path written INLINE, never assembled into a variable.
   *
   * `pnpm check:public-routes` reads call sites statically, so a path built up
   * in a local is invisible to it — which is exactly how a route that does not
   * exist upstream reaches production as a mystery 404.
   */
  const body = giftId ? { amountKash, giftId } : { amountKash };
  // Only the stream route reads a recipient; see the parameter's note.
  const giftBody = toProfileId ? { ...body, toProfileId } : body;
  const raw =
    target.kind === "post"
      ? await msApi.post(`/posts/${target.id}/tips`, body)
      : target.kind === "stream"
        ? await msApi.post(`/streams/${target.id}/gifts`, giftBody)
        : await msApi.post(`/profiles/${target.id}/tips`, body);
  const parsed = TipResponseSchema.parse(raw);
  return {
    tip: adopt(raw, target),
    toWallet: parsed.toWallet ?? null,
    legs: parsed.settlement?.legs ?? null,
  };
}

/**
 * Report the transfer the sender signed.
 *
 * The service RECORDS this and settles nothing: a hash from a client is a
 * claim, not proof, so the tip stays pending until kash's watcher observes the
 * transfer on-chain and the amount and both wallets check out. Nothing here
 * may tell the reader their money arrived.
 */
export async function reportTipTransfer(
  target: TipTarget,
  tipId: string,
  txHash: string,
): Promise<Tip> {
  /**
   * Posts and streams only, each path written INLINE.
   *
   * Two reasons. The service has no profile-tip route at all, so a profile
   * branch here would be a path that 404s dressed up as support for something.
   * And `pnpm check:public-routes` reads call sites statically: a path
   * assembled into a variable is invisible to it, which is exactly how a route
   * that does not exist upstream reaches production as a mystery 404. Written
   * out, these are checked like every other.
   */
  if (target.kind === "post") {
    return adopt(
      await msApi.post(`/posts/${target.id}/tips/${tipId}/transfer`, { txHash }),
      target,
    );
  }
  if (target.kind === "stream") {
    return adopt(
      await msApi.post(`/streams/${target.id}/gifts/${tipId}/transfer`, { txHash }),
      target,
    );
  }
  throw new Error("Only posts and streams can be tipped.");
}
