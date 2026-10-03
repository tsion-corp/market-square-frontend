import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { GIFT_PHASE_SAYS } from "../features/tips/lib/availability.ts";

/*
  A GIFT MUST SAY WHAT IT IS WAITING ON.

  `useSendTip` has reported `creating`/`signing`/`confirming`/`reporting`
  since it was written, the tip sheet uses them, and the GIFT path passed no
  `onPhase` at all. The tray also closes on send — so between the tap and the
  money settling the sender saw nothing whatsoever.

  That is why a send parked at a wallet prompt was indistinguishable from one
  that never ran: a tip created on the service, `txHash: null`, a balance that
  did not move, and nobody able to tell "broken" from "waiting". Hours went
  into that question, on a state the client already knew and never said.
*/

/*
  THE URL OBJECT, NOT ITS `pathname` — `new URL("..", import.meta.url).pathname`
  keeps a directory's space as `%20`, which `readFileSync` cannot open. On a
  checkout whose path contains one, this file threw before asserting anything.
*/
const root = new URL("../", import.meta.url);
const rooms = [
  "features/houses/components/house-room.tsx",
  "features/streams/components/stream-room.tsx",
] as const;
const code = (p: string) =>
  readFileSync(new URL(p, root), "utf8").replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");

test("both gift surfaces report the phase they are in", () => {
  for (const rel of rooms) {
    const source = code(rel);
    assert.match(source, /onPhase:\s*\(phase\)\s*=>/u, `${rel} must pass onPhase`);
    assert.match(source, /GIFT_PHASE_SAYS\[phase\]/u, `${rel} must use the shared wording`);
  }
});

test("the phases share ONE toast, so they replace rather than stack", () => {
  /*
    Twenty gifts each opening four toasts would bury the room. One id per send
    also means the final success or failure lands where the reader is already
    looking, instead of below four stale spinners.
  */
  for (const rel of rooms) {
    const source = code(rel);
    const start = source.indexOf("const toastId = `gift:");
    assert.notEqual(start, -1, `${rel} mints no per-send toast id`);
    const send = source.slice(start, start + 3000);
    const toasts = [...send.matchAll(/toast\.(loading|success|error)\(/gu)].length;
    const withId = [...send.matchAll(/\{ id: toastId \}/gu)].length;
    assert.ok(
      withId >= toasts - 1,
      `${rel}: ${toasts} toasts but only ${withId} carry the id — a loading toast would be left spinning`
    );
  }
});

test("`signing` is the phase that earns this, and it names the wallet", () => {
  /*
    It means a passkey, PIN or password sheet is open somewhere and the
    payment is waiting on a HUMAN. That is the exact state that looked like
    nothing happening, so the words have to point at the wallet.
  */
  assert.match(GIFT_PHASE_SAYS.signing, /wallet/iu);
  for (const phase of ["creating", "signing", "confirming", "reporting"]) {
    assert.ok(GIFT_PHASE_SAYS[phase], `no wording for ${phase}`);
  }
});

test("an unknown phase draws nothing rather than an empty toast", () => {
  // `undefined` from the map must not become a blank spinner the reader
  // cannot interpret — the rooms guard on it before calling toast.
  assert.equal(GIFT_PHASE_SAYS.idle, undefined);
  for (const rel of rooms) {
    assert.match(code(rel), /if \(says\) toast\.loading\(says/u, `${rel} must guard on the lookup`);
  }
});
