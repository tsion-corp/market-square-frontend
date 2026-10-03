import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/*
  THE HOUSE DIRECTORY WAITS UNTIL IT KNOWS WHO IS ASKING.

  The service excludes the reader's own houses from `/conversations/discover`,
  and says why in its own comment: "a Join House button on a house you are in
  is the surest way to make the control look broken." That exclusion is done
  against `viewerId` — and `viewerId` may be NULL, deliberately, because Home
  shows this rail to signed-out readers too.

  `msApi.get` attaches a token "when one exists". On Home the rail fires at
  first paint, before the session resolves, so no token exists yet and the
  service answers as if nobody is asking: every public house, including the
  ones the reader has already joined. The /houses page is navigated to later,
  by which time the session is up, so it gets the filtered list.

      Home     "Square Talk · 216 members · [Join House]"
      /houses  "No houses to explore yet"

  One route, two answers, reported as two bugs (ogazboiz: "i am already in a
  house because all this house i have join them, that is why if click on view
  more you wont see it" / "why in home it is still saying view more").

  `ready` is NOT `authenticated`. A signed-out reader reaches `ready: true` and
  still gets the directory — what is waited for is the ANSWER to "is there a
  session", not a session. Gating on `authenticated` would empty the rail for
  exactly the readers it was built to recruit.
*/

/*
  THE URL OBJECT, NOT ITS `pathname` — `new URL("..", import.meta.url).pathname`
  keeps a directory's space as `%20`, which `readFileSync` cannot open. On a
  checkout whose path contains one, this file threw before asserting anything.
*/
const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("features/messages/lib/discover-houses.ts", root), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");

/** Each exported hook's body, so a gate on one cannot vouch for the other. */
function hookBody(name: string): string {
  const start = code.indexOf(`export function ${name}`);
  assert.notEqual(start, -1, `${name} has been renamed`);
  const next = code.indexOf("export function ", start + 1);
  return code.slice(start, next === -1 ? undefined : next);
}

test("both directory reads wait for the viewer to be known", () => {
  for (const name of ["useDiscoverHouses", "useDiscoverHousesPages"]) {
    const body = hookBody(name);
    assert.match(
      body,
      /enabled:\s*ready/u,
      `${name} fires before the session resolves, so the service excludes nothing and offers Join on houses you are in`
    );
  }
});

test("it waits for READY, never for AUTHENTICATED", () => {
  /*
    The directory is public on purpose — the service's own note says Home
    shows it to a signed-out reader, and "a directory that requires an account
    to see what you might join has the order backwards". Gating on
    `authenticated` would hide it from precisely those readers.
  */
  assert.doesNotMatch(
    code,
    /enabled:\s*authenticated/u,
    "gating on authenticated hides the directory from signed-out readers, who are who it is for"
  );
  assert.match(code, /const \{ ready \} = useAuth\(\)/u);
});

test("the Home rail hides itself when there is nothing to join", () => {
  /*
    The other half of what was reported: "View more" led to an empty page.
    Once the rail sees the same filtered list the page does, an empty result
    must take the heading and its link with it rather than leaving a door into
    an empty room.
  */
  const rail = readFileSync(new URL("components/layout/popular-houses.tsx", root), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "");
  assert.match(
    rail,
    /if \(houses\.unavailable \|\| items\.length === 0\) return null;/u,
    "an empty rail must not render a View more into an empty page"
  );
});
