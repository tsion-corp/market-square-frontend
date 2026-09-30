import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * KASH AND COINS ARE NOT THE SAME THING.
 *
 * KASH is the money. Coins are what the gift tray spends. Being short of coins
 * opened the KASH top-up, so somebody with KASH already in their wallet was
 * sent to buy MORE KASH and came back with exactly as many coins as before —
 * none (ogazboiz, 2026-09-24: "i have to buy kash for me to get coin when i
 * have some kash in my wallet").
 *
 * Nothing failed. Both sheets work; they buy different things. That is why it
 * is pinned by name here rather than left to whoever next reads the wiring.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/**
 * The file with its COMMENTS removed.
 *
 * Twice now an assertion here has matched a word in the prose explaining why
 * something was removed, rather than the thing itself — a guard that fails on
 * its own reasoning is worse than none. Anything asserting that code is ABSENT
 * reads this instead.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "");

describe("being short of coins buys coins", () => {
  const rooms = [
    "features/houses/components/house-room.tsx",
    "features/streams/components/stream-room.tsx",
  ];

  it("opens the coin purchase from both rooms, never the KASH one", () => {
    for (const room of rooms) {
      const src = read(room);
      assert.match(src, /<CoinBuySheet/u, `${room} does not offer a coin purchase`);
      assert.doesNotMatch(
        src,
        /<KashBuySheet[\s\S]{0,120}topUpOpen/u,
        `${room} still sends a coin shortfall to the KASH top-up`
      );
    }
  });

  it("carries the shortfall, so the sheet can offer exactly what was missing", () => {
    // The overwhelmingly common reason to open this is that ONE gift was a
    // specific number of coins out of reach. Arriving at a generic pack list
    // makes the buyer do that subtraction themselves.
    const tray = read("components/ui/gift-sheet.tsx");
    assert.match(tray, /onTopUp\?: \(needed: number\) => void;/u, "the tray asks for no amount");
    assert.match(tray, /onTopUp\(total\)/u, "the Get more door forgets what was needed");
    assert.match(tray, /onTopUp\?\.\(total\)/u, "the Send button forgets what was needed");
    for (const room of rooms) {
      assert.match(read(room), /onTopUp=\{\(needed\) => \{/u, `${room} drops the shortfall`);
    }
  });
});

describe("the coin purchase is the one step where real money moves", () => {
  const hook = read("features/gifts/hooks/use-gifts.ts");

  it("signs, waits, and only then reports — the same order a tip uses", () => {
    // The KASH rail exposes mint and burn and NO transfer, and the platform is
    // non-custodial, so the buyer's own wallet is the only thing that can move
    // their money. `toWallet` present IS the instruction to sign.
    assert.match(hook, /if \(!purchase\.toWallet\)/u, "a purchase with nothing to sign is not handled");
    assert.match(hook, /phase\("signing"\)/u);
    assert.match(hook, /phase\("confirming"\)/u);
    assert.match(hook, /phase\("reporting"\)/u);
    assert.match(hook, /await reportCoinTransfer\(purchase\.id, txHash\)/u);
  });

  it("records the hash BEFORE waiting, which is what makes a retry free", () => {
    /*
      Between signing and reporting the money has MOVED and the service does
      not know. A retry that started over would sign a second transfer for
      coins already paid for. The transfer is already broadcast by the time the
      wait begins, so recording only successful payments would record exactly
      the ones that never needed rescuing.
    */
    const signed = hook.indexOf('holdPayment("coins"');
    const waited = hook.indexOf('phase("confirming")');
    assert.ok(signed > 0 && waited > 0, "the hold or the wait is gone");
    assert.ok(signed < waited, "the hash is recorded after the wait — a retry can now double-charge");
    assert.match(hook, /clearHeldPayment\("coins", wallet\)/u, "a settled purchase stays held for ever");
  });

  it("uses its OWN payment namespace, so a stranded purchase cannot be replayed as a tip", () => {
    // Both are a KASH transfer signed by the same wallet, and their recovery
    // paths report to different routes. Replaying one as the other would pay a
    // stranger the money somebody spent on coins.
    const store = read("lib/payment-store.ts");
    assert.match(store, /PaymentNamespace = "kash" \| "token" \| "tip" \| "ticket" \| "coins";/u);
    assert.match(hook, /heldPayment\("coins", wallet, key\)/u);
  });

  it("INVALIDATES the balance rather than writing it — the opposite of a gift buy", () => {
    /*
      A gift purchase settles instantly and its response IS the new balance, so
      that one is written. This one stays PENDING until the service observes
      the chain, so writing a number here would credit coins nobody has been
      given yet. The two buys are shaped differently on purpose.
    */
    const coinBuy = hook.slice(hook.indexOf("export function useBuyCoins"));
    assert.match(coinBuy, /invalidateQueries\(\{ queryKey: COINS_KEY \}\)/u);
    assert.doesNotMatch(coinBuy, /setQueryData\(COINS_KEY/u, "pending coins are being credited early");

    const giftBuy = hook.slice(hook.indexOf("export function useBuyGift"), hook.indexOf("export function useBuyCoins"));
    assert.match(giftBuy, /setQueryData\(COINS_KEY, result\.balance\)/u, "the instant buy went back to refetching");
  });

  it("never names a price, and always carries a key", () => {
    const api = read("features/gifts/lib/api.ts");
    const body = api.slice(api.indexOf("export async function buyCoins"));
    const posted = body.slice(body.indexOf('"/me/coins"'), body.indexOf("Idempotency-Key"));
    assert.doesNotMatch(posted, /kash|price/iu, "the client is naming an amount it must not choose");
    assert.match(body, /"Idempotency-Key": input\.idempotencyKey/u);
  });
});

describe("a deployment with no treasury says so", () => {
  const sheet = read("features/gifts/components/coin-buy-sheet.tsx");

  it("draws `purchasable: false` as a state, not an error", () => {
    // It means no treasury wallet is configured — there is nowhere to send the
    // money, so every purchase would be refused. A button that always fails is
    // worse than one that says it is not switched on yet.
    assert.match(sheet, /purchasable === false \?/u);
    assert.match(sheet, /aren&rsquo;t switched on yet/u);
    // Three states: `undefined` is the read still in flight and must not
    // render as a refusal, or the sheet flashes one on every open.
    assert.match(sheet, /purchasable === undefined/u, "an in-flight read is being treated as off");
  });

  it("derives its packs from the service's rate rather than typing them out", () => {
    // `coinsPerKash` lives in two repositories; a pack list written by hand is
    // a third place for it to be wrong.
    assert.match(sheet, /capability\.data\?\.coinsPerKash/u);
    // Comment-stripped: this file's own prose now explains the 0-KASH bug in
    // terms of "a rate of 1000", and a bare match found the explanation rather
    // than any code.
    assert.doesNotMatch(
      code("features/gifts/components/coin-buy-sheet.tsx"),
      /\b1000\b/u,
      "a coin rate is hard-coded in the pack list"
    );
  });

  it("promises coins are ON THE WAY, never that they arrived", () => {
    // The purchase is pending until the chain is observed; saying it landed
    // would claim a balance nobody has yet.
    assert.match(sheet, /are on their way/u);
    assert.doesNotMatch(sheet, /coins added/iu);
  });
});

/**
 * COINS ARE THE INVENTORY — there is no gift stock, and no step between
 * wanting to send and sending.
 *
 * ogazboiz settled the model: "we are doing it the tiktok way you understand
 * since no inventory". The client briefly bought stock inside the send, which
 * was the right client for the model that existed that hour. These pin what
 * replaced it, and in particular that the SEND IS ONE CALL — the thing that
 * makes a tap feel like TikTok rather than like a shop.
 */
describe("sending spends coins, in one call", () => {
  const room = read("features/houses/components/house-room.tsx");
  const roomCode = code("features/houses/components/house-room.tsx");
  const trayCode = code("components/ui/gift-sheet.tsx");
  const gridCode = code("components/ui/gift-grid.tsx");

  it("buys nothing before sending — the send is the whole gesture", () => {
    assert.doesNotMatch(roomCode, /buyGiftStock/u, "the room still buys stock before sending");
    assert.doesNotMatch(roomCode, /useGiftInventory/u, "the room still reads a stock it cannot spend");
    assert.doesNotMatch(roomCode, /shortfall/u, "a stock shortfall is still being computed");
    // One call, and it still carries the amount so the SAME body is correct in
    // both economies — charged when the switch is off, ignored when it is on.
    assert.match(room, /payGift\s*\.mutateAsync\(\{[\s\S]{0,200}amountKash,/u);
  });

  it("has no per-gift counts, because there is nothing per-gift to hold", () => {
    // What you hold is COINS, which the balance row says once rather than
    // fourteen times.
    assert.doesNotMatch(trayCode, /owned/u, "the tray still draws a stock count");
    assert.doesNotMatch(gridCode, /owned/u, "the grid still draws a stock count");
  });

  it("turns a refusal into the top-up, on the exact shortfall", () => {
    /*
      409 `INSUFFICIENT_COINS` carries `needed` and `balance` — the SAME code
      and fields the coin purchase answers with, so one handler covers both
      doors into the same wall and nobody guesses a number.

      A refused send spends nothing: the debit and the tip row are one
      transaction upstream.
    */
    assert.match(room, /const short = insufficientCoins\(error\);/u);
    assert.match(room, /setTopUpNeeded\(short\.needed - short\.balance\)/u);
  });

  it("reads the switch by its current name", () => {
    // Renamed from `spendGiftsFromInventory` when the model changed. Same
    // semantics, and still `=== true` so absent cannot open it.
    const schemas = read("lib/api/schemas.ts");
    assert.match(schemas, /spendGiftsFromCoins: z\.boolean\(\)\.optional\(\),/u);
    assert.doesNotMatch(schemas, /spendGiftsFromInventory/u, "the retired key is back");
  });
});

/**
 * A PACK'S PRICE IS MONEY AND MUST BE EXACT.
 *
 * The sheet rendered its cheapest pack as "0 KASH" — the 10-coin rung at a
 * rate of 1000, advertised as free (ogazboiz, 2026-09-24: "why is it showing
 * 0 dollar"). The cause was `(coins / rate).toFixed(rate % coins === 0 ? 0 : 2)`
 * with the modulo the wrong way round: `1000 % 10 === 0`, so it rounded to
 * zero places. Every other rung survived by luck, which is why it looked fine
 * until the tray sent somebody here for one Rose.
 */
describe("the coin sheet prices packs exactly", () => {
  const sheet = read("features/gifts/components/coin-buy-sheet.tsx");

  /** The component's own conversion, lifted so the arithmetic itself is tested. */
  const kashFor = (coins: number, rate: number): string => {
    const whole = Math.floor(coins / rate);
    const rest = coins % rate;
    if (rest === 0) return String(whole);
    return `${whole}.${String(rest).padStart(String(rate).length - 1, "0").replace(/0+$/u, "")}`;
  };

  it("never prints a real price as nothing", () => {
    // The rung that shipped broken, first.
    assert.equal(kashFor(10, 1000), "0.01", "the cheapest pack is free again");
    assert.equal(kashFor(20, 1000), "0.02");
    assert.equal(kashFor(150, 1000), "0.15");
    assert.equal(kashFor(1000, 1000), "1");
    assert.equal(kashFor(50000, 1000), "50");
    // Any shortfall the tray can hand over, across the whole ladder.
    for (const coins of [10, 20, 50, 100, 150, 200, 250, 500, 1000, 50000]) {
      assert.notEqual(kashFor(coins, 1000), "0", `${coins} coins priced at nothing`);
    }
  });

  it("does the arithmetic in integers, never through a float", () => {
    // Both sides are whole numbers, so the whole part and the remainder are
    // exact by construction. `toFixed` is what rounded a price to nothing.
    assert.match(sheet, /const whole = Math\.floor\(coins \/ rate\);/u);
    assert.match(sheet, /const rest = coins % rate;/u);
    assert.doesNotMatch(code("features/gifts/components/coin-buy-sheet.tsx"), /toFixed/u, "a price is being rounded again");
  });

  it("says what the KASH balance IS, since KASH is what it spends", () => {
    /*
      It promised "Paid from your KASH balance" and never said what that
      balance was — so somebody holding 0.14 KASH was offered a 50 KASH pack
      with nothing to tell them it was out of reach until the wallet refused.

      The same `useKashAccount` the earnings card reads, so the two cannot
      disagree about one number.
    */
    assert.match(sheet, /const kash = useKashAccount\(open\);/u);
    assert.match(sheet, /formatKash\(kashBalance\)/u);
  });

  it("marks a pack beyond the wallet, and marks NOTHING when the balance is unknown", () => {
    // Everywhere else short is a detour; here there is no onward door — this
    // IS the top-up. But a null balance is "not known", and greying the sheet
    // over a slow lookup invents a shortfall nobody can see.
    assert.match(sheet, /kashBalance !== null && exceedsBalance\(kashFor\(coins\), kashBalance\)/u);
    assert.match(sheet, /disabled=\{buy\.isPending \|\| tooDear\}/u);
  });
});

/**
 * THE ROOM'S CHAT POLL WAS 55% OF ALL ROOM TRAFFIC.
 *
 * A viewer in a live gist room made ~22 requests a MINUTE, and 12 of them were
 * the 5-second chat poll — spent mostly on being told nothing had changed. At
 * 1,000 viewers that is ~200 requests a second, continuously, against one API
 * and one Postgres, which is the real reason a room could not hold a thousand
 * people. The audio was never the constraint.
 */
describe("room chat is delivered, not polled for", () => {
  const hook = read("features/streams/hooks/use-live-chat.ts");
  const panel = read("features/streams/components/chat-panel.tsx");
  const room = read("features/houses/components/house-room.tsx");

  it("carries the MESSAGE, not a refetch signal", () => {
    /*
      The house pattern for gateway frames is "a frame is a refetch signal, the
      poll stays the floor", and it is right for a feed. It is WRONG here, and
      the arithmetic is why: a refetch signal makes every viewer fetch on every
      message, so N viewers and M messages is N x M requests. At 1,000 viewers
      and ten messages a minute that is 10,000 a minute — WORSE than the poll
      it replaced.

      Carrying the message makes it O(1) in viewers: LiveKit fans one packet
      out to everybody, which is what it is for.
    */
    assert.match(hook, /JSON\.stringify\(\{ id: message\.id, text: message\.text, createdAt: message\.createdAt \}\)/u);
    assert.match(panel, /queryClient\.setQueryData\(\["ms", "stream", stream\.id, "chat"\]/u);
    assert.doesNotMatch(
      code("features/streams/hooks/use-live-chat.ts"),
      /invalidateQueries/u,
      "chat went back to a refetch signal — that is N x M requests"
    );
  });

  it("takes the author from LIVEKIT, never from the packet", () => {
    /*
      Anything arriving is another browser, not our server. A heart carries no
      identity to forge; a MESSAGE does. `DataReceived` hands over the sending
      participant, whose identity our own service signed into their token — so
      the author is a lookup, not a claim. Without this, anyone in the room
      could publish a line as somebody else.
    */
    assert.match(hook, /if \(typeof identity !== "string" \|\| identity\.length === 0\) return;/u);
    assert.match(panel, /const authorId = baseIdentity\(packet\.fromIdentity\);/u);
    // And the payload's own idea of who sent it is never read.
    assert.doesNotMatch(code("features/streams/hooks/use-live-chat.ts"), /parsed.*author/u);
  });

  it("clamps everything a peer can set, and drops its own echo", () => {
    assert.match(hook, /id\.length > MAX_ID/u);
    assert.match(hook, /text\.length > MAX_TEXT/u);
    // Our own packet carries nothing new — we already hold the stored message.
    assert.match(hook, /if \(participant\?\.isLocal\) return;/u);
  });

  it("keeps the poll as a FLOOR, so a dropped packet heals", () => {
    // 5s -> 30s only when a room is connected. Without one — a feed card, a
    // broadcast nobody joined — nothing changes and the poll carries the panel
    // exactly as before.
    assert.match(panel, /const live = Boolean\(liveRoom\);/u);
    assert.match(panel, /useChat\(stream\.id, stream\.status === "live", live \? 30_000 : undefined\)/u);
    // Both room panels get the connection, or the desktop column silently
    // keeps polling while the phone sheet does not.
    assert.equal(
      [...room.matchAll(/liveRoom=\{room\}/gu)].length,
      2,
      "a room chat panel is still on the fast poll"
    );
  });

  it("publishes only AFTER the service accepted the message", () => {
    // The packet is an early copy of a message that already exists, so a
    // failed post publishes nothing and a dropped packet costs only latency.
    assert.match(panel, /onSuccess: \(sent\) => \{[\s\S]{0,300}if \(sent\) publishChat\(sent\);/u);
  });
});

/**
 * THE SEND PAYS BOTH PARTIES IN ONE TRANSACTION.
 *
 * ogazboiz: "it should go the remaining 50 percent to the reciever". Two
 * transfers would mean the money rests at the platform in between — a float, a
 * liability, a payout somebody has to sign. One batch means it never stops.
 */
describe("a split gift is paid as one batched call", () => {
  const hook = read("features/tips/hooks/use-tips.ts");
  const api = read("features/tips/lib/api.ts");

  it("batches to the sender's OWN address, not to the token", () => {
    /*
      The embedded wallet is upgraded in place via EIP-7702 to the shared
      SimpleAccount, so `executeBatch` is a call on THEMSELVES. Sending the
      batch calldata to the token address instead would be a transfer call the
      token does not have.
    */
    assert.match(hook, /to: wallet as `0x\$\{string\}`,\s*data: encodeExecuteBatch\(batched\)/u);
  });

  it("falls back to ONE transfer when the service names no legs", () => {
    // Absent legs is the compatibility path — every deployment that has not
    // shipped the split — not an error.
    assert.match(hook, /const batched = created\.legs/u);
    assert.match(hook, /: null;/u);
    assert.match(hook, /data: encodeErc20Transfer\(\s*created\.toWallet,/u);
  });

  it("reads the legs off the response, and keeps toWallet working", () => {
    // `toWallet` stays at the top level carrying the RECIPIENT's wallet, so
    // nothing that reads it today breaks — cheaper than a coordinated deploy.
    assert.match(api, /legs: parsed\.settlement\?\.legs \?\? null,/u);
    assert.match(api, /toWallet: parsed\.toWallet \?\? null,/u);
    // A list with roles, because a 100% share drops the platform leg entirely.
    assert.match(api, /kind: z\.literal\("split"\)/u);
    assert.match(api, /role: z\.string\(\)/u);
  });
});
