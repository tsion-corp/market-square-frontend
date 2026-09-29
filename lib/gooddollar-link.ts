// lz-string is CommonJS. A NAMED import works under the bundler but throws
// under Node's ESM loader, which is what runs the tests — so the module that
// carries this logic would be untestable. Default import, destructured here,
// works in both.
import lzString from "lz-string";

const { compressToEncodedURIComponent } = lzString;

/*
  THE LINK THAT TAKES A PLAYER TO GOODDOLLAR AND BRINGS THEM BACK.

  ─── WHY THIS IS WRITTEN OUT RATHER THAN IMPORTED ───────────────────────────
  GoodDollar ship @goodsdks/identity-sdk, and GameArena use it. Square cannot:
  the package imports `wagmi` at its top level for React hooks it also exports,
  so importing it at all would pull wagmi into an app that does not have it and
  does not need it. That is a large dependency to take on for one URL.

  What the SDK's `generateFVLink` actually does is small and entirely visible,
  so it is done here against `lz-string` alone — one zero-dependency package of
  a few kilobytes. The alternative, hand-rolling LZ-String's encoding, would be
  reckless: GoodDollar's server decompresses this, and a subtly different
  implementation fails at their end, on their screen, with our name on it.

  ─── THE PIECES ARE COPIED EXACTLY, AND PINNED BY TESTS ─────────────────────
  The signed message, the parameter names, and the redirect-vs-popup
  distinction all have to match what their server expects. Every one of them is
  asserted in the tests, so a change here fails locally rather than at the end
  of somebody's face scan.

  Nothing in this file touches a wallet. It takes a signature that was already
  produced and assembles a URL, which is what makes it testable.
*/

/**
 * GoodDollar's identity front end. Only production is wired: Square has one
 * deployment and a staging identity URL would verify people against a
 * different registry than the one their scores are checked against.
 */
const IDENTITY_URL = "https://goodid.gooddollar.org";

/**
 * The exact message GoodDollar expects the player to sign, with `<account>`
 * replaced by their address.
 *
 * Copied verbatim, including the line breaks and the warning — this string is
 * what the player reads in their wallet before approving, and it is also what
 * their server reconstructs to recover the address. A single changed character
 * produces a signature that recovers to nobody.
 */
export const FV_MESSAGE_TEMPLATE = `Sign this message to request verifying your account <account> and to create your own secret unique identifier for your anonymized record.
You can use this identifier in the future to delete this anonymized record.
WARNING: do not sign this message unless you trust the website/application requesting this signature.`;

export function fvMessage(address: string): string {
  return FV_MESSAGE_TEMPLATE.replace("<account>", address);
}

/** A second-resolution timestamp, which is the nonce shape their server reads. */
export function fvNonce(now: number = Date.now()): string {
  return Math.floor(now / 1000).toString();
}

export interface FvLinkInput {
  address: string;
  /** The signature over `fvMessage(address)`. */
  fvsig: string;
  chainId: number;
  /** Where GoodDollar sends the player when they are done. */
  callbackUrl: string;
  /**
   * Popup mode changes the parameter NAME, not just the window.
   *
   * Their server reads `cbu` for a popup and `rdu` for a redirect, and sending
   * the wrong one strands the player on GoodDollar's success screen with no
   * way back. Square is almost entirely mobile and always redirects, so this
   * defaults to false — but the distinction is here because getting it wrong
   * is invisible until somebody finishes a face scan.
   */
  popup?: boolean;
}

export function buildFvLink({
  address,
  fvsig,
  chainId,
  callbackUrl,
  popup = false,
  nonce = fvNonce(),
}: FvLinkInput & { nonce?: string }): string {
  if (!address) throw new RangeError("no address to verify");
  if (!fvsig) throw new RangeError("no signature to verify with");
  if (!callbackUrl)
    throw new RangeError("a redirect needs somewhere to return to");

  const params: Record<string, string | number> = {
    account: address,
    nonce,
    fvsig,
    chain: chainId,
    [popup ? "cbu" : "rdu"]: callbackUrl,
  };

  const url = new URL(IDENTITY_URL);
  url.searchParams.append(
    "lz",
    compressToEncodedURIComponent(JSON.stringify(params)),
  );
  return url.toString();
}
