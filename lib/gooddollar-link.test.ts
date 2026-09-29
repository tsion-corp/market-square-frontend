import assert from "node:assert/strict";
import { describe, it } from "node:test";
import lzString from "lz-string";
import {
  FV_MESSAGE_TEMPLATE,
  buildFvLink,
  fvMessage,
  fvNonce,
} from "./gooddollar-link.ts";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const SIG = "0xabc123";

/** What GoodDollar's server will actually read back out of the link. */
function decode(link: string): Record<string, unknown> {
  const lz = new URL(link).searchParams.get("lz");
  assert.ok(lz, "the link carries no payload");
  const json = lzString.decompressFromEncodedURIComponent(lz);
  assert.ok(json, "the payload does not decompress");
  return JSON.parse(json) as Record<string, unknown>;
}

/*
  THIS FILE IS WRITTEN OUT INSTEAD OF IMPORTED, so these tests are the only
  thing standing between a typo and a player discovering it at the END of a
  face scan, on GoodDollar's screen, with our name on it.
*/
describe("the message the player signs", () => {
  it("is GoodDollar's text, to the character", () => {
    // Their server reconstructs this to recover the address. One changed
    // character recovers to nobody, and the player is simply "not verified".
    assert.match(
      FV_MESSAGE_TEMPLATE,
      /^Sign this message to request verifying your account <account>/,
    );
    assert.match(
      FV_MESSAGE_TEMPLATE,
      /create your own secret unique identifier for your anonymized record\./,
    );
    assert.match(
      FV_MESSAGE_TEMPLATE,
      /You can use this identifier in the future to delete this anonymized record\./,
    );
    assert.match(
      FV_MESSAGE_TEMPLATE,
      /WARNING: do not sign this message unless you trust the website\/application requesting this signature\.$/,
    );
    // Three lines, not one: the wallet shows this to the player verbatim.
    assert.equal(FV_MESSAGE_TEMPLATE.split("\n").length, 3);
  });

  it("puts the player's own address in it", () => {
    const message = fvMessage(ADDRESS);
    assert.ok(message.includes(ADDRESS));
    assert.ok(!message.includes("<account>"), "the placeholder survived");
  });
});

describe("the nonce", () => {
  it("is seconds, not milliseconds", () => {
    assert.equal(fvNonce(1_700_000_000_000), "1700000000");
  });
});

describe("the link carries what their server reads", () => {
  it("round-trips every field through the compression", () => {
    const link = buildFvLink({
      address: ADDRESS,
      fvsig: SIG,
      chainId: 42220,
      callbackUrl: "https://square.tsionark.com/messages",
      nonce: "1700000000",
    });
    assert.deepEqual(decode(link), {
      account: ADDRESS,
      nonce: "1700000000",
      fvsig: SIG,
      chain: 42220,
      rdu: "https://square.tsionark.com/messages",
    });
  });

  it("points at GoodDollar's production identity front end", () => {
    const link = buildFvLink({
      address: ADDRESS,
      fvsig: SIG,
      chainId: 42220,
      callbackUrl: "https://square.tsionark.com/messages",
    });
    assert.equal(new URL(link).origin, "https://goodid.gooddollar.org");
  });

  /*
    THE PARAMETER NAME IS THE WHOLE RETURN TRIP. `rdu` for a redirect, `cbu`
    for a popup. Send the wrong one and the player finishes their face scan and
    is stranded on GoodDollar's success page with no way back to Square — a
    failure nobody sees until the very last step.
  */
  it("uses rdu for a redirect and cbu for a popup", () => {
    const base = {
      address: ADDRESS,
      fvsig: SIG,
      chainId: 42220,
      callbackUrl: "https://sq.test/back",
    };
    const redirect = decode(buildFvLink(base));
    assert.equal(redirect.rdu, "https://sq.test/back");
    assert.ok(!("cbu" in redirect));

    const popup = decode(buildFvLink({ ...base, popup: true }));
    assert.equal(popup.cbu, "https://sq.test/back");
    assert.ok(!("rdu" in popup));
  });

  it("carries the chain it was asked for", () => {
    const link = buildFvLink({
      address: ADDRESS,
      fvsig: SIG,
      chainId: 42220,
      callbackUrl: "https://sq.test/back",
    });
    assert.equal(decode(link).chain, 42220);
  });

  it("keeps a callback with its own query intact", () => {
    // The return address may carry state of ours; compression must not mangle
    // it and the reader must get back exactly what we sent.
    const callbackUrl = "https://sq.test/messages?thread=abc&from=game";
    const link = buildFvLink({
      address: ADDRESS,
      fvsig: SIG,
      chainId: 42220,
      callbackUrl,
    });
    assert.equal(decode(link).rdu, callbackUrl);
  });
});

describe("it refuses to build a link that cannot work", () => {
  const base = {
    address: ADDRESS,
    fvsig: SIG,
    chainId: 42220,
    callbackUrl: "https://sq.test/back",
  };
  it("refuses with no address", () => {
    assert.throws(() => buildFvLink({ ...base, address: "" }), RangeError);
  });
  it("refuses with no signature", () => {
    assert.throws(() => buildFvLink({ ...base, fvsig: "" }), RangeError);
  });
  it("refuses a redirect with nowhere to return to", () => {
    assert.throws(() => buildFvLink({ ...base, callbackUrl: "" }), RangeError);
  });
});
