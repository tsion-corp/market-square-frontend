import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ensureWalletProtected,
  isWalletProtectionDeclined,
  WalletProtectionDeclinedError,
} from "./wallet-protection.ts";

function wallet(state: { protected: boolean; protectResult?: boolean }) {
  const calls: string[] = [];
  return {
    calls,
    deviceProtected: async () => {
      calls.push("check");
      return state.protected;
    },
    protectDevice: async () => {
      calls.push("protect");
      state.protected = state.protectResult ?? true;
      return state.protected;
    },
  };
}

describe("wallet protection before a first action", () => {
  it("does nothing at all in the identity tier — no check, no ask, no prompt", async () => {
    // protectDevice() is a documented no-op returning false there; running the
    // gate would read that as "declined" and refuse every send.
    const w = wallet({ protected: false, protectResult: false });
    let asked = false;
    await ensureWalletProtected(w, async () => { asked = true; return true; }, "identity");
    assert.equal(asked, false);
    assert.deepEqual(w.calls, []);
  });

  it("passes a protected device through without asking", async () => {
    const w = wallet({ protected: true });
    let asked = false;
    await ensureWalletProtected(w, async () => {
      asked = true;
      return true;
    });
    assert.equal(asked, false);
    assert.deepEqual(w.calls, ["check"]);
  });

  it("asks first, then protects, on a device with no stored share", async () => {
    const w = wallet({ protected: false });
    await ensureWalletProtected(w, async () => true);
    assert.deepEqual(w.calls, ["check", "protect"]);
  });

  it("honours 'not now': nothing is stored and the action is refused", async () => {
    const w = wallet({ protected: false });
    await assert.rejects(
      ensureWalletProtected(w, async () => false),
      (e: unknown) => isWalletProtectionDeclined(e)
    );
    assert.deepEqual(w.calls, ["check"]);
  });

  it("treats a dismissed authenticator sheet as 'not now' too", async () => {
    const w = wallet({ protected: false, protectResult: false });
    await assert.rejects(ensureWalletProtected(w, async () => true), WalletProtectionDeclinedError);
  });

  it("names the declined error so an action can show its own line for it", () => {
    assert.equal(isWalletProtectionDeclined(new WalletProtectionDeclinedError()), true);
    assert.equal(isWalletProtectionDeclined(new Error("boom")), false);
    assert.equal(isWalletProtectionDeclined(null), false);
  });
});
