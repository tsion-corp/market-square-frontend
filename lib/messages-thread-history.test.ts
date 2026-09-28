import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anchorAfterPrepend,
  isNearTop,
  mergeHistory,
  NEAR_TOP_THRESHOLD,
} from "../features/messages/lib/thread-scroll.ts";

const m = (id: string) => ({ id });

describe("older messages in a thread", () => {
  it("asks for older well before the reader reaches the top", () => {
    assert.equal(isNearTop({ scrollTop: 0 }), true);
    assert.equal(isNearTop({ scrollTop: NEAR_TOP_THRESHOLD }), true);
    assert.equal(isNearTop({ scrollTop: NEAR_TOP_THRESHOLD + 1 }), false);
  });

  it("keeps the message the reader was looking at in place after a prepend", () => {
    // 1200px of history arrived above; the offset moves by exactly that.
    assert.equal(anchorAfterPrepend({ scrollTop: 150, scrollHeight: 3000 }, 4200), 1350);
    // Nothing arrived: nothing moves.
    assert.equal(anchorAfterPrepend({ scrollTop: 150, scrollHeight: 3000 }, 3000), 150);
  });

  it("reads oldest first across the newest page and every older page", () => {
    // Each page is newest-first as the service returns it.
    const newest = [m("9"), m("8"), m("7")];
    const older1 = [m("6"), m("5"), m("4")];
    const older2 = [m("3"), m("2"), m("1")];
    assert.deepEqual(
      mergeHistory(newest, [older1, older2]).map((x) => x.id),
      ["1", "2", "3", "4", "5", "6", "7", "8", "9"]
    );
  });

  it("keeps a message once when pages overlap after new messages shifted the newest page", () => {
    const newest = [m("10"), m("9"), m("8"), m("7")];
    const older1 = [m("7"), m("6"), m("5")];
    assert.deepEqual(mergeHistory(newest, [older1]).map((x) => x.id), ["5", "6", "7", "8", "9", "10"]);
  });

  it("is just the newest page before any history was fetched", () => {
    assert.deepEqual(mergeHistory([m("2"), m("1")], []).map((x) => x.id), ["1", "2"]);
  });
});
