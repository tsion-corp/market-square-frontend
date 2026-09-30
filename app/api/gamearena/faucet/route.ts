import { NextResponse, type NextRequest } from "next/server";
import { getRequestWallet, verifyRequest } from "@/lib/server/auth";
import {
  GAMEARENA_WRITE_TIMEOUT_MS,
  gameArenaConfigured,
  gameArenaFetch,
} from "@/lib/server/gamearena";

/**
 * Asks GameArena to put enough gas in this player's wallet to claim a name.
 *
 * ─── THE WALLET COMES FROM THE SESSION, AND HERE IT REALLY MATTERS ──────────
 * This one MOVES MONEY. A wallet taken from the request body would let anyone
 * signed in point a drip at an address they do not own — a drain dressed as an
 * onboarding step, repeated as fast as accounts can be made. So the address is
 * resolved from the verified session and the body carries nothing at all.
 *
 * ─── IT IS ONLY EVER FOR THE CLAIM ──────────────────────────────────────────
 * Square holds no value on Celo and pays no gas there. The one transaction a
 * Square player ever sends on that chain is `mint(username)`, and this exists
 * so that transaction can happen. It is not a balance top-up and must never
 * grow into one.
 *
 * ─── INERT UNTIL THEIR SIDE ALLOWS IT ───────────────────────────────────────
 * Their faucet is currently behind an internal secret Square does not hold and
 * must not hold, so this answers `funded: false` and the claim falls through
 * to the honest "your account needs a small top-up" message. Nothing about the
 * game changes while it is refused.
 */
export async function POST(req: NextRequest) {
  if (!gameArenaConfigured()) {
    return NextResponse.json({ funded: false, reason: "off" }, { status: 200 });
  }

  const claims = await verifyRequest(req);
  if (!claims) return NextResponse.json({ error: "sign in first" }, { status: 401 });

  const wallet = await getRequestWallet(req, claims);
  if (!wallet) {
    return NextResponse.json({ funded: false, reason: "no-wallet" }, { status: 200 });
  }

  try {
    /*
      THE FIELD IS `address`, NOT `wallet`.

      Their score route takes `wallet` and their faucet takes `address`, and
      sending the wrong one is accepted as a request with no address rather
      than refused — so it would have failed as an unfundable player rather
      than as a bad call. Taken from their contract, not guessed.
    */
    const upstream = await gameArenaFetch("/api/faucet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: wallet }),
      // A transfer, not a read: it broadcasts and waits on a node. The default
      // five seconds abandoned a request that had already sent the money.
      timeoutMs: GAMEARENA_WRITE_TIMEOUT_MS,
    });

    const body: unknown = await upstream.json().catch(() => null);
    const record = (body ?? {}) as Record<string, unknown>;
    const reason = typeof record.reason === "string" ? record.reason : null;

    if (record.success === true) {
      return NextResponse.json({ funded: true, reason: "sent" }, { status: 200 });
    }

    /*
      EVERY REFUSAL IS PASSED THROUGH BY NAME, because they mean different
      things to the player and collapsing them is how somebody is told to try
      again when what they actually need is to verify.

        already_claimed — funded once before; the gas may be spent
        not_fresh       — already holds enough; no drip needed, just mint
        unverified      — the GoodDollar gate; verifying is the way through
        daily_cap       — the global kill-switch, transient
        faucet_empty    — their faucet needs topping up; ours to report, not fix
    */
    if (reason) {
      return NextResponse.json({ funded: false, reason }, { status: 200 });
    }
    if (upstream.status === 401) {
      // Our key is wrong or unset — an operator's problem, never the player's.
      console.error("[gamearena] faucet rejected our partner key");
      return NextResponse.json({ funded: false, reason: "refused" }, { status: 200 });
    }
    console.error("[gamearena] faucet refused:", upstream.status);
    return NextResponse.json({ funded: false, reason: "refused" }, { status: 200 });
  } catch (error) {
    console.error(
      "[gamearena] could not reach the faucet:",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ funded: false, reason: "unreachable" }, { status: 200 });
  }
}
