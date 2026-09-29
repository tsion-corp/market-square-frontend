import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_SIMON_SCORE } from "./game-challenge.ts";
import { MAX_HANDLE, MAX_REPORT_BODY, parseScoreReport } from "./gamearena-report.ts";

const ok = (score: number, handle?: string) =>
  JSON.stringify(handle === undefined ? { score } : { score, handle });

describe("a score report is read strictly", () => {
  it("accepts a plain score", () => {
    assert.deepEqual(parseScoreReport(ok(120)), { ok: true, score: 120 });
  });

  it("accepts zero, because failing round one is a real result", () => {
    assert.deepEqual(parseScoreReport(ok(0)), { ok: true, score: 0 });
  });

  it("accepts the game's ceiling and refuses one past it", () => {
    assert.equal(parseScoreReport(ok(MAX_SIMON_SCORE)).ok, true);
    assert.deepEqual(parseScoreReport(ok(MAX_SIMON_SCORE + 1)), {
      ok: false,
      status: 400,
      error: "not a Simon score",
    });
  });

  it("carries a handle when there is one", () => {
    assert.deepEqual(parseScoreReport(ok(50, "ogazboiz")), {
      ok: true,
      score: 50,
      handle: "ogazboiz",
    });
  });
});

/*
  EVERY ONE OF THESE IS SOMETHING A CLIENT CAN ACTUALLY SEND. The route is
  behind a session, but a session is not a promise of good faith — it is a
  promise of identity.
*/
describe("it refuses what is not a score", () => {
  const bad: Record<string, string> = {
    "a negative score": ok(-1),
    "a fractional score": ok(12.5),
    "a score as a string": '{"score":"120"}',
    "no score at all": "{}",
    "null": "null",
    "an array": '[{"score":120}]',
    "not json": "score=120",
    "an empty body": "",
    "infinity": '{"score":1e999}',
  };
  for (const [name, raw] of Object.entries(bad)) {
    it(`refuses ${name}`, () => {
      const result = parseScoreReport(raw);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.status, 400);
    });
  }

  it("refuses a body too big to be a score", () => {
    const result = parseScoreReport(" ".repeat(MAX_REPORT_BODY + 1));
    assert.deepEqual(result, { ok: false, status: 413, error: "too large" });
  });

  /*
    NaN deserves its own line: `typeof NaN === "number"` and every comparison
    against it is false, so a check written as `score < 0 || score > MAX` alone
    would let it through and post a NaN upstream.
  */
  it("refuses NaN, which passes a naive range check", () => {
    // JSON has no NaN literal, so this is the shape that actually arrives.
    assert.equal(parseScoreReport('{"score":null}').ok, false);
    assert.equal(parseScoreReport(`{"score":${JSON.stringify(Number.NaN)}}`).ok, false);
  });
});

describe("the handle is a label, and is treated as one", () => {
  it("trims it to the cap upstream uses, so it is not renamed by them", () => {
    const long = "x".repeat(MAX_HANDLE + 20);
    const result = parseScoreReport(ok(10, long));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.handle, "x".repeat(MAX_HANDLE));
  });

  it("drops a blank handle rather than erasing a good name upstream", () => {
    assert.deepEqual(parseScoreReport(ok(10, "   ")), { ok: true, score: 10 });
    assert.deepEqual(parseScoreReport(ok(10, "")), { ok: true, score: 10 });
  });

  it("ignores a handle that is not text", () => {
    assert.deepEqual(parseScoreReport('{"score":10,"handle":42}'), { ok: true, score: 10 });
  });

  /*
    NOTHING IN A REPORT MAY NAME A PERSON. The wallet comes from the session;
    a body that tries to supply one must be ignored, not honoured, or a signed
    -in player could credit their plays to somebody else's address.
  */
  it("ignores a wallet in the body entirely", () => {
    const result = parseScoreReport('{"score":10,"wallet":"0xdeadbeef00000000000000000000000000000000"}');
    assert.deepEqual(result, { ok: true, score: 10 });
    assert.ok(!Object.hasOwn(result, "wallet"));
  });
});
