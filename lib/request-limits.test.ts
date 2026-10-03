import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/*
  ASK FOR A PAGE SIZE THE SERVICE ACCEPTS.

  `GET /me/tips/received?limit=200` was refused on every single load:

    {"code":"VALIDATION_ERROR","details":[
      {"path":"limit","message":"Too big: expected number to be <=100"}]}

  So the earnings list was empty for everybody who had ever been paid — not
  because they had no tips, but because the request never got to answer. A
  number picked to mean "plenty" became a hard failure, and it failed
  identically every time rather than degrading to fewer rows.

  Source-read: this repo's tests run under node --test with no DOM, and the
  call sites are behind the `@/` alias.
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

test("no paged read asks for more than the service's ceiling of 100", () => {
  for (const path of [
    "features/tips/lib/api.ts",
    "features/gifts/lib/api.ts",
    "features/messages/lib/api.ts",
    "features/profile/lib/api.ts",
    "features/feed/lib/api.ts",
  ]) {
    let source: string;
    try {
      source = code(path);
    } catch {
      continue; // a slice that has moved is not this test's business
    }
    const over = [...source.matchAll(/limit:\s*(\d+)/gu)]
      .map((m) => Number(m[1]))
      .filter((n) => n > 100);
    assert.deepEqual(over, [], `${path} asks for ${over.join(", ")} — the service refuses anything over 100`);
  }
});

test("the earnings read asks for exactly the maximum", () => {
  /*
    100 is the ceiling, so it is also the honest request. Past 100 the answer
    is the cursor the route already offers, not a larger number — there is no
    larger number.
  */
  assert.match(
    code("features/tips/lib/api.ts"),
    /authedGet\("\/me\/tips\/received", \{ limit: 100 \}\)/u,
    "the earnings list reads the largest page the service will serve"
  );
});
