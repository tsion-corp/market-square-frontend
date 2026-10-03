import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/*
  TWO MONEY BUGS FOUND BY AUDITING THE GIFT PATH, both live, both in shipped
  code, and neither related to the rapid-fire work that uncovered them.

  They share a shape: the gift path is the one surface a person is MEANT to
  fire repeatedly at the same person, and both defects are invisible until
  somebody does.
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
    .replace(/\{\/\*[\s\S]*?\*\/\}/gu, "")
    .replace(/\/\/[^\n]*/gu, "");

/* ── ONE PAYMENT MUST NOT SETTLE TWO TIPS ─────────────────────────────────── */

test("a held transfer may only be reported against the tip it was signed for", () => {
  /*
    The hold key canonicalises the AMOUNT, so two identical gifts to the same
    person in the same room collide on one key. Reusing the hash on `!txHash`
    alone reported gift #1's transfer against gift #2's tip and signed nothing:
    one payment, two tips — and since both tips agree on amount and on both
    parties, the reconciler cannot tell them apart either.
  */
  const tips = code("features/tips/hooks/use-tips.ts");
  assert.match(
    tips,
    /if \(!txHash \|\| held\?\.ref !== created\.tip\.tipId\)/u,
    "a hold whose ref names another tip is not this tip's to spend"
  );
});

test("the coin path's guard is the one being matched, not a new invention", () => {
  // The asymmetry WAS the bug: coins had this check from the start and tips
  // never did — and tips is the path built to be fired repeatedly.
  assert.match(
    code("features/gifts/hooks/use-gifts.ts"),
    /!txHash \|\| held\?\.ref !== purchase\.id/u,
    "the sibling guard must stay, or this test is pinning a pattern that no longer exists"
  );
});

/* ── A GIFT MUST REACH THE PERSON IT WAS AIMED AT ─────────────────────────── */

test("the tray follows the caller's chosen recipient, not the one at mount", () => {
  /*
    `useState(initialRecipientId)` captures once. `house-room` renders the
    sheet unconditionally, so it mounts with the room and never again: the
    prop changed on every "Gift" tap and `toId` stayed null, falling through
    to `people[0]`. Money to the wrong human, silently.
  */
  const sheet = code("components/ui/gift-sheet.tsx");
  // The bug shape specifically: the RECIPIENT held as state seeded from the
  // prop. `lastNamed` is also seeded from it and is the fix, not the defect —
  // an assertion broad enough to catch both would fail on the cure.
  assert.doesNotMatch(
    sheet,
    /\[toId, setToId\] = useState/u,
    "the recipient must be derived from the prop, not captured once at mount"
  );
  assert.match(sheet, /picked \?\? initialRecipientId/u, "the caller's choice is the source");
  assert.match(
    sheet,
    /setLastNamed\(initialRecipientId \?\? null\);\s*setPicked\(null\)/u,
    "naming a different person must clear a stale in-sheet pick"
  );
});

test("the sheet is mounted unconditionally, which is what makes that bug live", () => {
  /*
    Pinned because it is the premise. If house-room ever wraps the sheet in
    `{giftsOpen && ...}` the remount would mask the defect — and the fix above
    would look like dead code to whoever read it next.
  */
  const room = code("features/houses/components/house-room.tsx");
  const at = room.indexOf("<GiftSheet");
  assert.notEqual(at, -1, "GiftSheet has moved");
  const before = room.slice(Math.max(0, at - 120), at);
  assert.doesNotMatch(
    before,
    /\{\s*giftsOpen\s*&&\s*$/u,
    "if this becomes conditional, re-check whether the recipient sync is still needed"
  );
});

test("the reset happens during render, never in an effect", () => {
  /*
    React's documented way to adjust state when a prop changes. An effect would
    cascade a second render per recipient change, and lint refuses setState
    inside one — the same rule that caught the coin sheet earlier today.
  */
  const sheet = code("components/ui/gift-sheet.tsx");
  assert.doesNotMatch(sheet, /useEffect\([^)]*setPicked/u, "no effect-driven reset");
});

/* ── SIGN WHAT WAS AGREED, NOT WHAT CAME BACK ─────────────────────────────── */

test("the echoed amount is checked against the committed one before signing", () => {
  /*
    The request carries the total the tray showed. Everything after it signed
    `created.tip.amountKash` — the SERVICE'S ECHO — and nothing compared them.

    `transferCallsForLegs` does verify the legs sum to the total, but that
    total IS the echo, so it proves internal consistency and says nothing about
    whether the figure matches what anybody saw. A signature is the last point
    at which the sender's agreement is still revocable, so a mismatch has to be
    refused before the wallet is asked.
  */
  const tips = code("features/tips/hooks/use-tips.ts");
  assert.match(
    tips,
    /compareKashAmounts\(created\.tip\.amountKash, amountKash\) !== 0/u,
    "an echo that is not the committed amount must never reach the wallet"
  );
  const guard = tips.indexOf("compareKashAmounts(created.tip.amountKash");
  const signs = tips.indexOf("await send(");
  assert.ok(guard !== -1 && signs !== -1 && guard < signs, "the check must precede the signature");
});

test("the comparison is in base units, so 0.5 and 0.50 are the same money", () => {
  /*
    Text comparison would refuse a send that is exactly right. `compareKashAmounts`
    pads both fractions and compares as integers — the same reason
    `lib/account-batch.ts` compares legs in base units rather than as strings.
  */
  const tips = code("features/tips/hooks/use-tips.ts");
  assert.doesNotMatch(
    tips,
    /created\.tip\.amountKash\s*!==\s*amountKash/u,
    "string inequality would reject 0.5 against 0.50"
  );
});

/*
  A PAID TRANSFER MUST BE REPORTED BEFORE ANYTHING THAT CAN THROW.

  `send` returns only once the userOperation receipt is in hand, so by the time
  it resolves the money HAS moved. The flow then waited for a confirmation and
  reported afterwards — so a dropped connection, a closed tab, a slow RPC or a
  phone locking in between left the service with a tip whose `txHash` is NULL,
  permanently. The transfer is on-chain, kash reconciles it, and nothing can
  ever match it to a tip that has no hash.

  The held payment in sessionStorage was the only recovery, and it only works
  if the SAME browser retries within the hour. Nobody retries a gift that
  looked like it worked.

  Reporting first is free: the service treats the hash as a CLAIM and settles
  nothing until kash observes the transfer independently.
*/
const source = readFileSync("features/tips/hooks/use-tips.ts", "utf8");
const signing = source.slice(source.indexOf("txHash = await send("));

test("reports before it waits for the receipt", () => {
  const report = signing.indexOf("reportTipTransfer(target, created.tip.tipId, txHash)");
  const wait = signing.indexOf("await waitForReceipt(txHash");
  assert.ok(report > -1 && wait > -1, "both steps must still exist");
  assert.ok(report < wait, "a report after the wait is lost whenever the wait throws");
});

test("holds the payment before reporting, so a throw mid-report is still recoverable", () => {
  const hold = signing.indexOf('holdPayment("tip", wallet,');
  const report = signing.indexOf("reportTipTransfer(target, created.tip.tipId, txHash)");
  assert.ok(hold > -1 && hold < report, "the local record must precede the remote one");
});

/*
  A REVERTED TRANSFER IS NOT RETRACTED. The service verifies on-chain and
  will never observe a reverted transfer, so the tip expires rather than
  crediting anybody. Retracting would be the client asserting an outcome the
  service is better placed to judge — but the READER is still told.
*/
test("still tells the reader when the transfer reverted", () => {
  assert.match(signing, /The transfer failed on-chain\. Nothing was sent\./);
});

test("does not report the same tip twice", () => {
  assert.match(source, /reportedTip \?\? \(await reportTipTransfer\(/);
});
