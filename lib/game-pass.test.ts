import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CELO_CHAIN_ID,
  USERNAME_MAX,
  USERNAME_MIN,
  isSameName,
  nameKey,
  nameProblem,
  nameProblemMessage,
  sanitiseName,
} from "./game-pass.ts";

/*
  THE CONTRACT IS THE AUTHORITY, AND THESE PIN US TO IT.

  A client more permissive than the chain sends a transaction that reverts
  after the player has waited and been told nothing useful. A client stricter
  than the chain refuses names that were actually free. Both are silent.
*/
describe("a name is valid exactly when the contract says so", () => {
  it("accepts the shortest and longest the contract allows", () => {
    assert.equal(nameProblem("a".repeat(USERNAME_MIN)), null);
    assert.equal(nameProblem("a".repeat(USERNAME_MAX)), null);
  });

  it("refuses one character either side of the bounds", () => {
    assert.equal(nameProblem("a".repeat(USERNAME_MIN - 1)), "too-short");
    assert.equal(nameProblem("a".repeat(USERNAME_MAX + 1)), "too-long");
  });

  /*
    THE REVERT STRING LIES. It reads "3-16 chars, a-z 0-9 _", but
    _validUsername also accepts 0x41-0x5A. Anyone implementing from the error
    message rejects names the chain would have taken.
  */
  it("accepts UPPERCASE, which the contract's own error message denies", () => {
    assert.equal(nameProblem("OgazBoiz"), null);
    assert.equal(nameProblem("ABC"), null);
  });

  it("accepts digits and underscore", () => {
    assert.equal(nameProblem("og_1"), null);
    assert.equal(nameProblem("___"), null);
    assert.equal(nameProblem("123"), null);
  });

  it("refuses everything outside the four allowed ranges", () => {
    for (const bad of [
      "og az",
      "og-az",
      "og.az",
      "ogaz!",
      "ogaz🎮",
      "øgaz",
      "og\naz",
    ]) {
      assert.equal(nameProblem(bad), "bad-characters", bad);
    }
  });

  it("refuses an empty name as empty, not as too short", () => {
    // They are different moments: one is "you have not started", the other is
    // "what you have is not enough".
    assert.equal(nameProblem(""), "empty");
  });

  /*
    An emoji is several BYTES but one or two JS characters, so a length-first
    check could call a 3-emoji name valid on one side and not the other. The
    charset rule catches it before length is ever consulted.
  */
  it("catches a multi-byte name by its characters, not by a length that means two things", () => {
    assert.equal(nameProblem("🎮🎮🎮"), "bad-characters");
  });
});

describe("the problem is said in the player's language", () => {
  it("never mentions the chain, the contract or a revert", () => {
    for (const problem of [
      "empty",
      "too-short",
      "too-long",
      "bad-characters",
    ] as const) {
      const message = nameProblemMessage(problem);
      assert.ok(message.length > 0);
      assert.doesNotMatch(
        message,
        /chain|contract|revert|transaction|wallet|gas/i,
        message,
      );
    }
  });
});

/*
  UNIQUENESS IS CASE-INSENSITIVE ON CHAIN — _usernameTaken is keyed on
  _lower(s) while usernameOf keeps the capitals. Comparing as typed would tell
  somebody a taken name is free, and they would find out from a revert.
*/
describe("names collide without regard to case", () => {
  it("treats different capitalisations as the same claim", () => {
    assert.ok(isSameName("OgazBoiz", "ogazboiz"));
    assert.ok(isSameName("ABC", "abc"));
    assert.equal(nameKey("OgazBoiz"), "ogazboiz");
  });

  it("still treats genuinely different names as different", () => {
    assert.ok(!isSameName("ogazboiz", "ogazboi"));
    assert.ok(!isSameName("og_az", "ogaz"));
  });
});

describe("typing is shaped into something claimable", () => {
  it("drops characters the chain would refuse", () => {
    assert.equal(sanitiseName("og az!"), "ogaz");
    assert.equal(sanitiseName("🎮ogaz"), "ogaz");
    assert.equal(sanitiseName("og-az.1"), "ogaz1");
  });

  it("keeps case, because the chain does", () => {
    assert.equal(sanitiseName("OgazBoiz"), "OgazBoiz");
  });

  it("trims a long paste to the cap, so it is not renamed later", () => {
    assert.equal(sanitiseName("a".repeat(40)), "a".repeat(USERNAME_MAX));
  });

  it("always produces something the validator accepts, or too-short", () => {
    for (const raw of [
      "og az!",
      "🎮🎮",
      "a",
      "!!!!",
      "OgazBoiz",
      "a".repeat(40),
    ]) {
      const cleaned = sanitiseName(raw);
      const problem = nameProblem(cleaned);
      assert.ok(
        problem === null || problem === "too-short" || problem === "empty",
        `${raw} -> ${cleaned} -> ${problem}`,
      );
    }
  });
});

describe("where the pass lives", () => {
  it("is Celo, not the chain the rest of Square is on", () => {
    assert.equal(CELO_CHAIN_ID, 42220);
  });
});
