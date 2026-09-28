// Wallet protection — and, since decane-connect-kit 2.27, the tier that
// decides whether there is anything to protect.
//
// Square runs the kit's IDENTITY tier (app/providers.tsx): no passkey, no
// password, nothing stored on the device. Signing in is the whole ceremony,
// every visit, and the enclave provisions a fresh share against the sign-in
// alone. The security statement, verbatim from the kit: the wallet is exactly
// as safe as the account the reader signs in with plus Decane; anyone who can
// obtain a valid session can sign; there is no device-bound factor. Decane
// mitigates with a new-device email and a per-user freeze switch.
//
// In that tier `protectDevice()` is a documented no-op returning false, so the
// gate below must not run — it would read "false" as "declined" and refuse
// every send. It stays for the DEVICE tier, where the first wallet action —
// a tip, a gift, a purchase — is where the passkey or password is asked for:
// before anything is signed, the device is checked, the reader is told why,
// and the kit stores the share. "Not now" is honoured and the action is not
// performed.

/** Square's tier. One place, read by app/providers.tsx and by the gate below. */
export const SQUARE_WALLET_PROTECTION: "identity" | "device" = "identity";

export interface ProtectableWallet {
  deviceProtected(): Promise<boolean>;
  protectDevice(): Promise<boolean>;
}

export class WalletProtectionDeclinedError extends Error {
  constructor() {
    super("Protect your wallet to continue.");
    this.name = "WalletProtectionDeclinedError";
  }
}

export function isWalletProtectionDeclined(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === "WalletProtectionDeclinedError";
}

/**
 * Resolves once this device holds a protected share for the signed-in
 * account. `ask` is the explainer (a dialog); it answers whether to go on.
 */
export async function ensureWalletProtected(
  wallet: ProtectableWallet,
  ask: () => Promise<boolean>,
  tier: "identity" | "device" = "device"
): Promise<void> {
  // Nothing to protect and nothing to ask: the identity tier holds no share
  // on this device by design. See the note at the top of this file.
  if (tier === "identity") return;
  if (await wallet.deviceProtected()) return;
  if (!(await ask())) throw new WalletProtectionDeclinedError();
  // False is the kit reporting a dismissed authenticator sheet or password
  // dialog: nothing was stored. Same answer as "not now".
  if (!(await wallet.protectDevice())) throw new WalletProtectionDeclinedError();
}
