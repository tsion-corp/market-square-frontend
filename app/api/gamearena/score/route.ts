import { NextResponse, type NextRequest } from "next/server";
import { getRequestWallet, verifyRequest } from "@/lib/server/auth";
import { MAX_REPORT_BODY, parseScoreReport } from "@/lib/gamearena-report";

/**
 * Reports a Simon score played in Square onto GameArena's boards.
 *
 * ─── WHY THIS IS A ROUTE AND NOT A FETCH FROM THE PAGE ──────────────────────
 * GameArena authenticates partners with a single long-lived key. That key is
 * the whole authority — whoever holds it can write any score for any wallet —
 * so it lives HERE, in an environment variable read on the server, and never
 * in a bundle, a NEXT_PUBLIC_ variable or a response body. A browser that
 * could see it could write scores for strangers forever.
 *
 * It is also the only thing Square holds of theirs. Their validator key, their
 * faucet key and their database credentials stay on their side; this route can
 * report a score and read nothing.
 *
 * ─── THE WALLET COMES FROM THE SESSION, NEVER FROM THE BODY ─────────────────
 * This is the same hazard the KASH proxy carries, for the same reason: the
 * upstream keys everything on the wallet it is handed. If this route took a
 * wallet from the request, any signed-in user could credit their plays to
 * somebody else's address — or bury a rival's board under zeroes. So the body
 * carries a score and nothing that names a person.
 *
 * ─── WHAT THIS ROUTE CANNOT PROVE, STATED PLAINLY ───────────────────────────
 * It cannot prove a game was played. The sequence is derived from a seed that
 * travels in the challenge, so the client already knows every answer and a
 * crafted POST looks exactly like an honest one. Capping and rate-limiting
 * narrow the damage; they do not close it.
 *
 * That is precisely why these scores belong on GameArena's SEPARATE partner
 * board rather than merged into their native Simon leaderboard, whose scores
 * are recomputed server-side from a sequence their server issued. Mixing the
 * two would put unvalidated numbers beside validated ones with nothing in the
 * data to tell them apart. If that merge is ever wanted, the fix is not more
 * checking here — it is playing their issued sequence and submitting through
 * their validated path.
 */

/** Their backend. Unset means the integration is simply off — the same way
    their own partner routes stay inert until a partner is configured. */
const GAMEARENA_API = (process.env.GAMEARENA_API_URL ?? "").replace(/\/+$/, "");
const PARTNER_KEY = process.env.GAMEARENA_PARTNER_KEY ?? "";

/** Upstream is not in the player's way: a board that is slow must not hold a
    thread open, so the report is abandoned rather than awaited indefinitely. */
const UPSTREAM_TIMEOUT_MS = 5000;

function configured(): boolean {
  return GAMEARENA_API.length > 0 && PARTNER_KEY.length > 0;
}

export async function POST(req: NextRequest) {
  // Not configured is not an error the player should see. Their game was
  // played and their card is already correct; only the leaderboard write is
  // absent, and that is an operator's problem, not theirs.
  if (!configured()) return NextResponse.json({ reported: false, reason: "off" }, { status: 200 });

  const claims = await verifyRequest(req);
  if (!claims) return NextResponse.json({ error: "sign in first" }, { status: 401 });

  const wallet = await getRequestWallet(req, claims);
  // A signed-in player with no resolvable wallet is a real state, not a fault:
  // there is simply no address to credit, so nothing is reported and the game
  // is unaffected.
  if (!wallet) return NextResponse.json({ reported: false, reason: "no-wallet" }, { status: 200 });

  // Read at most one body's worth before parsing, so an enormous POST is
  // refused by length rather than buffered in full and then rejected.
  const raw = await req.text();
  const report = parseScoreReport(raw.slice(0, MAX_REPORT_BODY + 1));
  if (!report.ok) return NextResponse.json({ error: report.error }, { status: report.status });
  const { score, handle } = report;

  try {
    const upstream = await fetch(`${GAMEARENA_API}/api/partner/score`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-partner-key": PARTNER_KEY },
      body: JSON.stringify({ wallet, score, ...(handle ? { name: handle } : {}) }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!upstream.ok) {
      // Logged, not echoed: an upstream refusal may name their internals, and
      // a score that failed to post is not something the player can act on.
      console.error("[gamearena] score rejected upstream:", upstream.status);
      return NextResponse.json({ reported: false, reason: "upstream" }, { status: 200 });
    }

    const result: unknown = await upstream.json().catch(() => null);
    const onchain =
      !!result && typeof result === "object" && (result as Record<string, unknown>).onchain === true;

    // `onchain` is the honest distinction: every score reaches their board, but
    // it only becomes a transaction once that wallet holds a GamePass. The
    // client uses this to decide whether to offer the player a pass, and must
    // never claim a transaction happened when it did not.
    return NextResponse.json({ reported: true, onchain }, { status: 200 });
  } catch (error) {
    console.error(
      "[gamearena] could not reach the partner API:",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ reported: false, reason: "unreachable" }, { status: 200 });
  }
}
