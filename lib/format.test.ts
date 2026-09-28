import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatKash, kashAmount } from "./format.ts";

describe("KASH precision follows the money", () => {
  it("drops decimals from a whole amount", () => {
    assert.equal(formatKash("80"), "80 KASH");
    assert.equal(formatKash("80.00000000"), "80 KASH");
  });

  it("shows two decimals when there are cents", () => {
    assert.equal(formatKash("80.5"), "80.50 KASH");
    assert.equal(formatKash("80.25"), "80.25 KASH");
  });

  it("cuts extra decimals instead of rounding a balance up", () => {
    assert.equal(kashAmount("80.259"), "80.25");
    assert.equal(kashAmount("80.999"), "80.99");
  });

  /*
    THIS SUITE USED TO ASSERT THE BUG: `kashAmount("0.009") === "0"`.

    It was correct while every credit was a whole number of cents. Once gifts
    became a 50/50 split, half of the cheapest gift in the tray fell below a
    cent and the assertion was pinning a row that tells somebody they were
    paid nothing.
  */
  it("NEVER renders a non-zero amount as zero", () => {
    assert.equal(kashAmount("0.009"), "0.009");
    assert.equal(kashAmount("0.0001"), "0.0001");
    // Small enough that even three decimals vanish — the digits run on to the
    // first significant one rather than collapsing. Not pinned to today's
    // ladder, so a future price or split cannot bring the bug back.
    assert.equal(kashAmount("0.00000004"), "0.00000004");
    assert.equal(kashAmount("5e-3"), "0.005");
  });

  it("shows the gift ladder's recipient share exactly", () => {
    // Rose 0.01 -> 0.005, Heart 0.02 -> 0.01, Book 0.05 -> 0.025.
    assert.equal(formatKash("0.005"), "0.005 KASH");
    assert.equal(formatKash("0.01"), "0.01 KASH");
    assert.equal(formatKash("0.025"), "0.025 KASH");
  });

  /*
    Earnings rows sit under the BALANCE and people add them up. Five 0.025
    gifts shown as "0.02" total 0.10 against a balance of 0.125 — a list that
    disagrees with the figure above it.
  */
  it("keeps a list of credits in agreement with the balance above it", () => {
    const credits = ["0.025", "0.025", "0.025", "0.025", "0.025"];
    const shown = credits.map(kashAmount);
    assert.deepEqual(shown, ["0.025", "0.025", "0.025", "0.025", "0.025"]);
    assert.equal(kashAmount("0.125"), "0.125");
  });

  it("stays at two decimals at or above 1 KASH, where the third is noise", () => {
    assert.equal(kashAmount("80.500"), "80.50");
    // The zero guard is scoped to amounts UNDER 1 KASH: these were never at
    // risk of reading as zero, so the third decimal is cut as it always was.
    assert.equal(kashAmount("1.005"), "1");
    assert.equal(kashAmount("80.009"), "80");
    // Below 1 the same digit is most of the amount.
    assert.equal(kashAmount("0.1278572857142857"), "0.127");
    assert.equal(kashAmount("0.100"), "0.10");
  });

  it("keeps the sign on a small negative amount", () => {
    assert.equal(kashAmount("-0.005"), "-0.005");
  });

  it("leaves a value that is not a number as it came", () => {
    assert.equal(formatKash("abc"), "abc KASH");
  });
});
