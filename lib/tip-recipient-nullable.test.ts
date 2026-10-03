import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/*
  A PAYMENT THAT SUCCEEDED MUST NOT BE REPORTED AS A FAILURE.

  ogazboiz sent a rose from a gist room. The service answered **201**, the
  burst played, the money moved — and this client threw:

    [{"expected":"object","code":"invalid_type","path":["recipient"],
      "message":"Invalid input: expected object, received null"}]

  `TipTarget.recipient` has been `Profile | null` all along and `adopt()`
  copies it straight into `TipSchema`, which demanded an object. TypeScript
  could not see the contradiction because `.parse()` takes `unknown` — the
  schema and the type that feeds it disagreed, and only a real gist room gift
  ever put a null through it.

  `house-room` passes `recipient: null` deliberately: the room resolves who is
  being gifted from its own roster and never loads a full `Profile` for them.
  So null means "not named here", never "nobody was paid".
*/

/*
  THE URL OBJECT, NOT ITS `pathname` — `new URL("..", import.meta.url).pathname`
  keeps a directory's space as `%20`, which `readFileSync` cannot open. On a
  checkout whose path contains one, this file threw before asserting anything.
*/
const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const code = (path: string) =>
  read(path).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "").replace(/\{\/\*[\s\S]*?\*\/\}/gu, "");

test("the schema accepts the null its own callers pass", () => {
  const types = code("features/tips/lib/types.ts");
  assert.match(
    types,
    /recipient:\s*ProfileSchema\.nullable\(\)/u,
    "adopt() copies TipTarget.recipient, which is `Profile | null`"
  );
});

test("a gist room really does pass null, so this is not theoretical", () => {
  /*
    The guard that keeps the two halves honest. If the room ever starts
    resolving a full Profile the nullable schema stays correct; if this line
    disappears while the schema is tightened again, the same 201-then-throw
    comes back.
  */
  assert.match(
    code("features/houses/components/house-room.tsx"),
    /recipient:\s*null/u,
    "house-room passes no Profile for a gift recipient"
  );
});

test("every reader treats null as 'not named', never as 'nobody paid'", () => {
  const hook = code("features/tips/hooks/use-tips.ts");
  assert.match(
    hook,
    /if \(tip\.recipient\)/u,
    "invalidating a profile query needs a username, and there is none to use"
  );

  /*
    THE RECEIPT HALF WENT WITH THE TIP SHEET.

    That sheet rendered "Sent to <name>" and had to guard a null recipient — a
    gist-room gift names nobody, and the bug this file exists for was
    `Sent to undefined`. Posts now open the room's gift sheet, which never
    renders a recipient name at all, so there is no interpolation left to
    guard.

    The rule itself is unchanged and still pinned above: `recipient` is
    NULLABLE on the wire and `use-tips` must not reach through it. What is gone
    is one reader, not the reason.
  */
});

test("the null comes from adopt() copying the target, which is why tsc missed it", () => {
  /*
    NOT a re-implementation of the type checker. `tsc` already enforces every
    dereference — it is what caught `tip-sheet.tsx` the moment the schema went
    nullable, and a regex that tried to do the same job flagged a use that was
    correctly inside an `if (tip.recipient)` guard.

    What tsc CANNOT see is this line: `.parse()` takes `unknown`, so the schema
    and the value feeding it were free to disagree for as long as no room
    passed a null. That is the seam, and it is what this pins.
  */
  const api = code("features/tips/lib/api.ts");
  assert.match(
    api,
    /recipient:\s*target\.recipient/u,
    "adopt() copies the target's recipient straight into TipSchema"
  );
  assert.match(
    code("features/tips/lib/types.ts"),
    /recipient:\s*import\("@\/lib\/api\/schemas"\)\.Profile \| null/u,
    "TipTarget.recipient is nullable, so the schema it feeds must be too"
  );
});
