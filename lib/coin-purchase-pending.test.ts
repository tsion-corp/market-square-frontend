import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/*
  THE BUG TOOK HIS MONEY ONCE; THE SILENCE TOOK IT THREE TIMES.

  ogazboiz paid for one pack of coins THREE times, roughly two minutes apart,
  and all three payments were real — 0.01 KASH each, on Base, to the treasury,
  readable on chain. Only the first was caused by the missing settlement
  caller. The second and third were caused by this sheet: it toasted "on their
  way" and CLOSED, putting him back on a tray that still read 0 coins with Buy
  as the only control in front of him.

  A purchase here is pending by design — the service credits nothing until it
  has seen the chain — so there is always a gap between paying and receiving.
  Any step where money leaves before the thing arrives needs a visible
  in-between, or people pay again. That is a rule about payments, and it
  outlives coins: the same gap exists in any first-send experience where a
  transfer is signed before a balance moves.

  Source-read rather than rendered, because this repo's tests run under
  `node --test` with no DOM. What is pinned is the shape that cost money: the
  sheet does not close on success, the button cannot be pressed again, and the
  notice says the balance will still read zero.
*/

/*
  THE URL OBJECT, NOT ITS `pathname` — `new URL("..", import.meta.url).pathname`
  keeps a directory's space as `%20`, which `readFileSync` cannot open. On a
  checkout whose path contains one, this file threw before asserting anything.
*/
const root = new URL("../", import.meta.url);
const sheet = readFileSync(new URL("features/gifts/components/coin-buy-sheet.tsx", root), "utf8");

/** The source with comments stripped — a rule must be in the CODE, not near it. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
}

test("a paid purchase does not close the sheet", () => {
  const body = code(sheet);
  const success = /onSuccess: \(\) => \{([\s\S]*?)\n\s{20}\},/u.exec(body);
  assert.ok(success, "the success handler has moved; this guard no longer reads it");
  assert.doesNotMatch(
    success[1],
    /onClose\(\)/u,
    "closing on success is what sent him back to a tray reading 0 coins with Buy in front of him"
  );
  assert.match(success[1], /setAwaiting\(/u, "a paid purchase must leave the sheet in a waiting state");
});

test("Buy cannot be pressed again while a purchase is pending", () => {
  const body = code(sheet);
  // The BUY button specifically — the one whose guard mentions the mutation.
  // The pack buttons have a `disabled` of their own and are not this.
  const guards = [...body.matchAll(/disabled=\{([^}]*)\}/gu)].map((match) => match[1]);
  // `purchasable` is read only by the BUY button; the pack buttons also guard
  // on `buy.isPending`, so that alone picks the wrong one.
  const buyGuard = guards.find((guard) => guard.includes("purchasable"));
  assert.ok(buyGuard, `no buy-button guard found among ${guards.length} disabled expressions`);
  assert.match(
    buyGuard,
    /waiting/u,
    "the second and third payments went through a button that was still enabled"
  );
});

test("the notice says the balance will still read zero", () => {
  /*
    The specific sentence that would have stopped him. "Your coins are coming"
    next to a balance of 0 on the same screen reads as a failure — so the
    notice has to name the amount AND warn that the number above it has not
    moved yet, or it argues with what the buyer can see.
  */
  assert.match(sheet, /awaiting\.coins\.toLocaleString\(\)/u, "the notice must name what was paid for");
  assert.match(sheet, /still shows 0/u, "the notice must say the balance has not moved yet");
  assert.match(sheet, /don&rsquo;t buy again|don't buy again/u, "the notice must say not to pay again");
});

test("the notice clears when the coins ARRIVE, never on a timer", () => {
  /*
    Cleared by the balance RISING past what it was when they paid, not by it
    being non-zero: a buyer who already held coins would otherwise never see
    the notice at all. And never by a timeout, which would re-enable Buy while
    the purchase was still pending — reintroducing the exact retry.
  */
  const body = code(sheet);
  assert.match(body, /balance > awaiting\.from/u, "the notice must clear on the balance rising");
  assert.doesNotMatch(body, /setTimeout\([^)]*setAwaiting/u, "a timer would re-enable Buy while still pending");
  // Derived during render rather than cleared from an effect: setting state
  // inside an effect cascades renders, and this is a pure function of what
  // they paid for and what the balance has done since.
  assert.doesNotMatch(body, /useEffect\([^)]*setAwaiting/u, "clearing this from an effect sets state during render");
});
