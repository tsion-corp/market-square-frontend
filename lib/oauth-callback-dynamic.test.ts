import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/*
  THE OAUTH CALLBACK IS NEVER PRERENDERED.

  ONE COMMIT, TWO VERCEL PROJECTS, ONE GREEN AND ONE RED:

      market-square-frontend   Decane env set      -> built
      market-square-ark        Decane env missing  -> failed

  `AuthCallbackPage` calls `useSocialAuth()`, which throws unless it is inside
  `<DecaneKit>`; the kit only mounts once `useDecaneCredentials()` resolves,
  which is a browser fetch. So whether the prerender got far enough to call the
  hook depended on whether NEXT_PUBLIC_DECANE_APP_ID happened to be set at
  BUILD time — a page whose build depends on a runtime credential.

  Reproduced locally by removing the two Decane variables: the build failed
  with ark's exact error, and passed with this export in place and the
  variables still absent.

  The page catches an OAuth redirect and reads what the provider put in the
  URL. There is no state of it worth computing at build time, so prerendering
  it produces a shell nobody sees and one more way for a build to fail.
*/

/*
  THE URL OBJECT, NOT ITS `pathname` — `new URL("..", import.meta.url).pathname`
  keeps a directory's space as `%20`, which `readFileSync` cannot open. On a
  checkout whose path contains one, this file threw before asserting anything.
*/
const root = new URL("../", import.meta.url);
const page = readFileSync(new URL("app/auth/callback/page.tsx", root), "utf8");

test("the OAuth callback opts out of prerendering", () => {
  assert.match(
    page.replace(/\/\*[\s\S]*?\*\//gu, ""),
    /export const dynamic = "force-dynamic"/u,
    "without this the build only passes where the Decane env happens to be set"
  );
});

test("the reason is recorded on the page, not only in a commit message", () => {
  /*
    The next person to tidy "unused" exports needs the two project names in
    front of them, because removing this breaks a DIFFERENT deployment from
    the one they are looking at — and it builds fine locally.
  */
  assert.match(page, /market-square-ark/u, "name the deployment this protects");
  assert.match(page, /DecaneKit|DECANE/u, "name what throws when it is prerendered");
});
