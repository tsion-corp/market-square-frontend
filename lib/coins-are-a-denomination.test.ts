import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/*
  A COIN IS A VIEW OF KASH. THERE IS NO STORED BALANCE TO READ.

  Verified on the service's own `origin/main` rather than assumed:

    · `spendCoinsOnGift` exists in the repository layer and has NO CALLER in
      any service.
    · `tip-service` — where a gift actually goes — contains no coin read and no
      coin debit on either path.

  So the stored balance is credited by a purchase and spent by nothing. That is
  why ogazboiz could send a gift, watch the recipient receive their 50%, and
  still see `0 coins`: the number was never what the send drew on.

  ─── THE GATE THAT WAS WRONG, AND MUST NOT COME BACK ────────────────────────
  The first version derived the balance only when `spendGiftsFromCoins` was
  FALSE. That flag names the MONEY path, not the display:

    true   pay at the send, split into the recipient's leg and the platform fee
    false  the old single-leg path — recipient 100%, Square 0%

  So that gate tied a display fix to turning Square's revenue off. Shipping it
  would have looked like a UI change and silently ended the platform's cut.
*/

/*
  THE URL OBJECT, NOT ITS `pathname` — `new URL("..", import.meta.url).pathname`
  keeps a directory's space as `%20`, which `readFileSync` cannot open. On a
  checkout whose path contains one, this file threw before asserting anything.
*/
const root = new URL("../", import.meta.url);
const code = (path: string) =>
  readFileSync(new URL(path, root), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/[^\n]*/gu, "");

const hook = code("features/gifts/hooks/use-gifts.ts");
const sheet = code("features/gifts/components/coin-buy-sheet.tsx");
const balance = hook.slice(hook.indexOf("export function useCoinBalance"));

test("the balance is derived from KASH, not read from a stored one", () => {
  assert.match(balance, /coinsFromKash\(/u, "a derived balance is the model");
  assert.doesNotMatch(
    balance,
    /fetchCoinBalance/u,
    "/me/coins returns a number nothing spends; reading it is what showed 0 to somebody holding KASH"
  );
});

test("THE DISPLAY IS NEVER GATED ON THE MONEY SWITCH", () => {
  /*
    The specific mistake. `spendGiftsFromCoins === false` is the no-split path,
    so gating the derived display on it would ship a UI change that ends
    Square's 50%. If a gate is ever wanted again it must be its own flag.
  */
  for (const [name, source] of [["use-gifts", hook], ["coin-buy-sheet", sheet]] as const) {
    assert.doesNotMatch(
      source,
      /giftsComeFromCoins/u,
      `${name}: the display must not depend on which money path the service takes`
    );
  }
});

test("there is nothing to buy — the sheet hands over to the KASH top-up", () => {
  assert.match(sheet, /KashBuySheet/u, "Get more must lead to KASH");
  assert.match(
    sheet,
    /if \(!keepLegacyPurchase\)/u,
    "the handover is unconditional behind a one-line escape hatch, not a live capability"
  );
});

test("the handover sits BELOW every hook", () => {
  /*
    The first cut returned before five hooks — a different hook order per
    render. Lint caught it; this keeps it caught if that rule is relaxed.
  */
  const body = sheet.slice(sheet.indexOf("export function CoinBuySheet"));
  const handover = body.indexOf("return <KashBuySheet");
  assert.notEqual(handover, -1, "the handover has moved");
  for (const call of ["useGiftCapability(", "useCoinBalance(", "useKashAccount(", "useBuyCoins("]) {
    const at = body.indexOf(call);
    assert.notEqual(at, -1, `${call} has moved`);
    assert.ok(at < handover, `${call} must run before the early return`);
  }
});
