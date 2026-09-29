import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readHandoff } from "./square-handoff.ts";

const TOKEN = "eyJhbGciOiJFUzI1NiJ9.eyJ1aWQiOiJ1LTEifQ.sig";

describe("the session Market hands over", () => {
  it("takes the token and hands back the URL without it", () => {
    assert.deepEqual(readHandoff(`/square?decane_token=${TOKEN}`), {
      token: TOKEN,
      cleanUrl: "/square",
    });
  });

  it("keeps the rest of the query and the fragment", () => {
    assert.deepEqual(
      readHandoff(`/square/u/korex?tab=posts&decane_token=${TOKEN}#top`),
      {
        token: TOKEN,
        cleanUrl: "/square/u/korex?tab=posts#top",
      },
    );
  });

  it("is null when nothing was handed over", () => {
    assert.equal(readHandoff("/square"), null);
    assert.equal(readHandoff("/square?tab=posts"), null);
    assert.equal(readHandoff("/square?decane_token="), null);
  });
});
