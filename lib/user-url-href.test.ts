import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

/*
  A USER-SET URL THAT BECOMES AN `href` IS CHECKED HERE, WHATEVER THE SERVICE DOES.

  `javascript:` in an anchor runs script in the visitor's session, on our origin.
  In an `<img src>` it does not, and has not since the IE era — which is why most
  of the URL fields in this product were never a vector and why saying "every
  surface that draws a person" about an avatar is an overstatement that costs a
  real finding its credibility. The shape that matters is: user-controlled, and
  rendered as something a stranger clicks.

  THE HOUSE PAGE WAS NOT CHECKED, and the comment above it explained why:

    "the service allows http(s) only and refuses anything else at its own
     boundary, so this renders whatever it sent without re-judging it"

  That guarantee was real, tested, and UNMERGED. So the sentence described a
  guard that had not shipped, and the field accepted `javascript:` in production
  while the code said it could not. Same shape as every other thing that went
  wrong this week: a comment stating a rule, and the rule not being true.

  These assert the GUARD, not the service's promise, because the whole point is
  that this layer cannot be wrong about which version of the service it is
  talking to.

  See `room-guests.test.ts` for why the URL goes to readFileSync whole.
*/

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Every place a user-settable URL is rendered as a clickable anchor. */
const ANCHORS: Array<[string, string]> = [
  ["a house's website", "components/layout/house-profile-screen.tsx"],
  ["a profile's website", "features/profile/components/profile-page.tsx"],
  ["an admin announcement link", "components/layout/announcement-band.tsx"],
];

describe("a user-set URL rendered as a link", () => {
  for (const [what, path] of ANCHORS) {
    it(`${what} is scheme-checked before it becomes an href`, () => {
      const source = read(path);
      assert.ok(
        source.includes("isHttpUrl("),
        `${path} renders a user URL as an anchor and must call isHttpUrl first`
      );
    });
  }

  it("checks with the URL parser, never a regex on the string", () => {
    /*
      `z.string().url()` is a SHAPE check and passes `javascript:alert(1)` — that
      is how twenty-one fields on the service carried this exposure. A prefix
      test is the same mistake in client clothing: `javascript:/*https://x*` and
      a leading-whitespace or control-character variant both defeat one, and the
      parser defeats neither of them by accident — it answers the protocol.
    */
    const helper = read("lib/http-url.ts");
    assert.match(helper, /new URL\(value\)/u, "ask the parser");
    assert.match(
      helper,
      /url\.protocol === "http:" \|\| url\.protocol === "https:"/u,
      "an allowlist of two schemes, not a denylist of the one we thought of"
    );
  });

  it("keeps the check even once the service enforces it too", () => {
    /*
      Two guards is not duplication when one of them is a network away. This
      layer cannot know which version of the service answered, and the house
      page is the proof: it trusted a boundary that had not shipped.
    */
    const house = read("components/layout/house-profile-screen.tsx");
    assert.ok(
      !/renders whatever it sent without re-judging it/u.test(house),
      "the comment claiming the service already guarantees this must not come back"
    );
  });
});
