import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/*
  A PAYMENT IS NEVER RETRIED BY THE TRANSPORT.

  viem's http transport defaults to THREE retries and retries on 408, 429, 502
  and 504 — exactly the statuses our own bundler proxy returns when Alchemy is
  throttled (429 passed through), unreachable (502), or slower than the proxy's
  30s ceiling (504).

  `eth_sendUserOperation` is not idempotent. If a userOperation reaches Alchemy
  and EXECUTES, but the proxy has already stopped waiting for the answer, a
  retry submits a second one — and the account's nonce advanced when the first
  executed, so the second is valid and executes too. One tap, two payments, and
  no error anywhere in the client.

  ogazboiz: "no i paid once still pay again". Three transfers left his wallet,
  0.01 KASH each, 34 and 17 blocks apart — roughly 68 and 34 seconds, which is
  the shape of a 30s timeout plus a retry rather than of somebody tapping. All
  three were single-leg transfers to the treasury, so none of them was a
  recipient being paid a share.

  A read may retry. A send may not. That is the rule this pins.
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

test("the bundler transport disables retries, because a send is not idempotent", () => {
  const sponsor = code("lib/trade/sponsor.ts");
  const transport = /const transport = http\(([\s\S]*?)\n\s*\}\);/u.exec(sponsor);
  assert.ok(transport, "the bundler transport has moved; this guard no longer reads it");
  assert.match(
    transport[1],
    /retryCount:\s*0/u,
    "without this viem retries eth_sendUserOperation up to 3 times on 429/502/504 and can pay twice"
  );
});

test("the proxy still returns the statuses viem would have retried on", () => {
  /*
    The other half of the pair. If the proxy stopped answering 429/504 this
    guard would be protecting against nothing — and if somebody later removes
    `retryCount: 0` believing the proxy is quiet, these are the answers that
    would start the double-payments again.
  */
  const bundler = code("lib/server/alchemy-bundler.ts");
  assert.match(bundler, /status:\s*timedOut\s*\?\s*504\s*:\s*502/u, "the timeout/unreachable answers");
  // 429 is not written as a literal — it is Alchemy's, passed through verbatim.
  assert.match(bundler, /status:\s*last\.status/u, "the upstream status is passed through, 429 included");
});

test("reads keep their retries — the rule is about sends, not about caution", () => {
  /*
    `publicClientForChain` carries every on-chain READ and is deliberately
    left alone: a repeated `eth_getCode` or receipt poll costs a request and
    cannot move money. Narrowing that too would be cargo-culting this rule.
  */
  const receipt = code("lib/trade/receipt.ts");
  assert.doesNotMatch(
    receipt,
    /retryCount:\s*0/u,
    "reads are idempotent; disabling their retries would degrade every balance and receipt poll for nothing"
  );
});
