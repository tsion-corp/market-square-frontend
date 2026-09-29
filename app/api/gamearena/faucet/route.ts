import { NextResponse, type NextRequest } from "next/server";
import { getRequestWallet, verifyRequest } from "@/lib/server/auth";
import { gameArenaConfigured, gameArenaFetch } from "@/lib/server/gamearena";

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
    const upstream = await gameArenaFetch("/api/faucet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet }),
    });

    /*
      ALREADY FUNDED IS NOT A FAILURE. Their faucet allows one drip per wallet,
      so a second ask is refused — and the right response to that is to go and
      try the claim anyway, because the gas may already be sitting there. It is
      reported separately so the client can tell the two apart.
    */
    if (upstream.status === 409) {
      return NextResponse.json({ funded: false, reason: "already" }, { status: 200 });
    }
    if (!upstream.ok) {
      console.error("[gamearena] faucet refused:", upstream.status);
      return NextResponse.json({ funded: false, reason: "refused" }, { status: 200 });
    }
    return NextResponse.json({ funded: true }, { status: 200 });
  } catch (error) {
    console.error(
      "[gamearena] could not reach the faucet:",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ funded: false, reason: "unreachable" }, { status: 200 });
  }
}
