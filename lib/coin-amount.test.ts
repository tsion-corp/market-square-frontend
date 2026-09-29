import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptsCoinKeystroke, kashFromCoins, parseTipAmount } from "./tips.ts";
import { COINS_PER_KASH } from "./gifts.ts";

/*
  ONE SHEET, ONE CURRENCY.

  The gift tiles have always been priced in coins and the room's tray quotes
  coins. The tip sheet's free-amount field asked for KASH — so one sheet quoted
  two currencies and the reader had to know the rate to compare a typed amount
  with a tile they had just looked at.
*/
describe("coins convert to the rail's KASH exactly", () => {
  it("matches the gift ladder", () => {
    // The prices on the tiles, which are what the reader is comparing against.
    assert.equal(kashFromCoins("10"), "0.01"); // Rose
    assert.equal(kashFromCoins("20"), "0.02"); // Heart
    assert.equal(kashFromCoins("50"), "0.05"); // Book
    assert.equal(kashFromCoins("1000"), "1");
    assert.equal(kashFromCoins("50000"), "50"); // the dearest gift
  });

  it("never produces a float artefact", () => {
    // Three Roses is 30 coins. Through a float this is 0.030000000000000002.
    assert.equal(kashFromCoins("30"), "0.03");
    assert.equal(kashFromCoins("1"), "0.001");
    assert.equal(kashFromCoins("999"), "0.999");
  });

  it("agrees with the rate it claims", () => {
    assert.equal(kashFromCoins(String(COINS_PER_KASH)), "1");
  });

  /*
    THE FLOOR IS TEN COINS, and it is not arbitrary.

    `parseTipAmount` accepts at most `MAX_TIP_DECIMALS` (2) places, so 0.001 —
    a single coin — is refused as too precise. Ten coins is 0.01, which is
    exactly the Rose, the cheapest thing on the ladder. So the rail's precision
    and the catalogue's floor already agree, and nothing needs relaxing: there
    is no gift that costs less than the smallest sendable amount.

    Discovered by this test failing rather than assumed — my first expectation
    here was that one coin would send.
  */
  it("produces something the tip parser accepts, from ten coins up", () => {
    for (const coins of ["10", "30", "1000", "50000"]) {
      const kash = kashFromCoins(coins);
      const parsed = parseTipAmount(kash);
      assert.ok(parsed.ok, `${coins} coins -> ${kash} was rejected by the parser`);
    }
  });

  it("refuses a single coin, because the rail cannot carry it", () => {
    const parsed = parseTipAmount(kashFromCoins("1"));
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok === false && parsed.reason, "too-precise");
  });

  it("refuses anything that is not a whole coin", () => {
    // A fraction of a coin is not a thing anybody holds, and allowing it would
    // put the sheet back to quoting a unit nobody prices in.
    for (const bad of ["0.5", "1.5", "-1", "1e3", "abc", ""]) {
      assert.equal(kashFromCoins(bad), "", `${JSON.stringify(bad)} should not convert`);
    }
  });
});

describe("the coin field only admits coins", () => {
  it("takes digits and an empty field", () => {
    for (const ok of ["", "1", "50", "50000", "123456"]) {
      assert.equal(acceptsCoinKeystroke(ok), true, ok);
    }
  });

  it("refuses a decimal point, a sign, and an absurd length", () => {
    for (const bad of [".", "1.", "1.5", "-1", "+1", "1234567", "1e3", " 1"]) {
      assert.equal(acceptsCoinKeystroke(bad), false, bad);
    }
  });
});
