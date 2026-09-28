import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const client = readFileSync("lib/api/client.ts", "utf8");
const token = readFileSync("lib/auth-token.ts", "utf8");

/*
  A PUBLIC READ MUST WAIT FOR AUTH TO SETTLE, OR IT ASKS ANONYMOUSLY.

  `currentAccessToken()` is null "when signed out, hydrating or not mounted",
  and only the `requireAuth` branch ever waited out the hydrating case. So on a
  COLD REFRESH every public read went out with no Authorization and the service
  answered as an anonymous caller.

  An anonymous caller does not get the personalised fields. `isFollowing` is
  OMITTED for them by design, and an omitted follow edge renders as "Follow" —
  so the feed and every profile showed people the reader already follows as
  unfollowed, and stayed that way, because nothing refetched once the token
  arrived. Their own Following list was correct throughout: it is an authedGet
  and it DID wait.

  Read as source rather than behaviour because `apiFetch` needs a browser, a
  Decane provider and a live upstream to exercise; the shape of the guard is
  what regresses, and it is the shape that is pinned.
*/
describe("a public read does not ask the service who nobody is", () => {
  it("still waits when auth has not settled", () => {
    assert.match(
      client,
      /if \(!accessToken && !opts\.requireAuth && !getAuthSnapshot\(\)\.ready\) \{\s*\n\s*await waitForAuthReady\(\);/,
      "a public read must wait out hydration before deciding it has no token",
    );
  });

  it("re-reads the token after waiting, rather than sending the stale null", () => {
    const guard = client.slice(client.indexOf("!opts.requireAuth && !getAuthSnapshot()"));
    const after = guard.slice(0, guard.indexOf("if (opts.requireAuth"));
    assert.match(after, /accessToken = currentAccessToken\(\);/, "waiting and not re-reading changes nothing");
  });

  /*
    The wait is conditional on BOTH: a token we do not have, and auth that has
    not settled. Without the `ready` check a signed-out visitor would wait on
    every public read for a token that is never coming.
  */
  it("costs a signed-out visitor nothing", () => {
    assert.match(client, /!accessToken && !opts\.requireAuth && !getAuthSnapshot\(\)\.ready/);
    assert.doesNotMatch(
      client,
      /if \(!accessToken && !opts\.requireAuth\) \{\s*\n\s*await waitForAuthReady/,
      "an unconditional wait makes every signed-out read pay for a token that never arrives",
    );
  });

  /*
    The comment that started this. If it ever stops being true — if the token
    becomes available synchronously — the guard above is harmless, but the
    reasoning for it should be re-read rather than inherited.
  */
  it("is anchored to the token source that admits it hydrates late", () => {
    assert.match(token, /null when signed out, hydrating or not mounted/);
  });
});
