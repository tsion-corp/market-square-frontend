import { NextResponse, type NextRequest } from "next/server";
import { getRequestWallet, verifyRequest } from "@/lib/server/auth";
import { gameArenaConfigured, gameArenaFetch } from "@/lib/server/gamearena";

/**
 * What GameArena knows about the signed-in player: whether they hold a pass,
 * the name on it, and whether they are a verified human right now.
 *
 * ─── THE ANSWER IS NEVER CACHED, AND THAT IS THE WHOLE POINT ────────────────
 * `verified` reads GoodDollar's `isWhitelisted`, which is status==1 AND inside
 * a reverification window — and on Celo that window is THREE DAYS for a
 * first-time verifier, 180 only after they verify a second time.
 *
 * So a player verifies on Friday and is not verified by Monday. Caching this,
 * at any layer, reproduces exactly the bug GameArena's own players reported:
 * verified once, then told days later that they were not. `no-store` here and
 * on the upstream call, and every caller re-reads it rather than remembering
 * it.
 *
 * The pass is different and does NOT lapse: it is soulbound and permanent, and
 * `recordScore` checks only that it exists. So a player whose verification has
 * expired keeps counting — only their verified-human standing needs renewing.
 */
export async function GET(req: NextRequest) {
  if (!gameArenaConfigured()) {
    return NextResponse.json(
      { available: false },
      { status: 200, headers: noStore() },
    );
  }

  const claims = await verifyRequest(req);
  if (!claims)
    return NextResponse.json({ error: "sign in first" }, { status: 401 });

  const wallet = await getRequestWallet(req, claims);
  // A signed-in reader with no resolvable wallet is a real state, not a fault:
  // there is no address to ask about, so there is nothing to report.
  if (!wallet) {
    return NextResponse.json(
      { available: false },
      { status: 200, headers: noStore() },
    );
  }

  try {
    const upstream = await gameArenaFetch(`/api/partner/profile/${wallet}`);
    if (!upstream.ok) {
      console.error("[gamearena] profile refused upstream:", upstream.status);
      return NextResponse.json(
        { available: false },
        { status: 200, headers: noStore() },
      );
    }
    const body: unknown = await upstream.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { available: false },
        { status: 200, headers: noStore() },
      );
    }
    const record = body as Record<string, unknown>;

    /*
      Read field by field rather than forwarded whole. Passing an upstream
      body straight through is how a field we never agreed to ends up being
      relied on by a component, and how an upstream shape change becomes a
      rendering bug instead of a caught one.
    */
    return NextResponse.json(
      {
        available: true,
        hasPass: record.hasPass === true,
        username: typeof record.username === "string" ? record.username : null,
        verified: record.verified === true,
      },
      { status: 200, headers: noStore() },
    );
  } catch (error) {
    console.error(
      "[gamearena] could not reach the partner API:",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { available: false },
      { status: 200, headers: noStore() },
    );
  }
}

/** Belt and braces against anything between here and the browser deciding a
    three-day-old "verified: true" is still worth serving. */
function noStore(): Record<string, string> {
  return { "cache-control": "no-store, max-age=0, must-revalidate" };
}
