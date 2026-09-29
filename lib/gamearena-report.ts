import { MAX_SIMON_SCORE } from "./game-challenge.ts";

/*
  THE BODY OF A SCORE REPORT, PARSED WHERE IT CAN BE ATTACKED.

  This is attacker-controlled input: anybody with a session can POST it. The
  parsing therefore lives here rather than inside the route, because this repo
  runs `node --test` over lib/ and never over app/ — logic buried in a route
  handler is logic nothing tests.

  It deliberately has NO notion of a wallet. The route takes that from the
  session, never from the body, so there is nothing here that could name a
  person: a report says how well somebody did, and the server decides who
  somebody is.
*/

/** Room for a score and a handle, and nothing else. */
export const MAX_REPORT_BODY = 1024;

/** Upstream stores a partner-side display name capped at 32. Matching that cap
    here means a long handle is trimmed once, by us, rather than silently
    truncated by them into a different name than the player has. */
export const MAX_HANDLE = 32;

export type ReportParse =
  | { ok: true; score: number; handle?: string }
  | { ok: false; status: 400 | 413; error: string };

/**
 * Read a score report, or say exactly why it is not one.
 *
 * Returns a result rather than throwing because every branch is an ordinary
 * outcome with its own HTTP status — a thrown error would collapse "too big"
 * and "not a number" into one 500.
 */
export function parseScoreReport(raw: string): ReportParse {
  if (raw.length > MAX_REPORT_BODY)
    return { ok: false, status: 413, error: "too large" };

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    // `typeof null === "object"`, and an ARRAY is an object too — both would
    // sail through a bare typeof check and then read `.score` as undefined,
    // which is a 400 either way but for a confusing reason.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, status: 400, error: "bad body" };
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, status: 400, error: "bad body" };
  }

  const score = body.score;
  if (
    typeof score !== "number" ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > MAX_SIMON_SCORE
  ) {
    return { ok: false, status: 400, error: "not a Simon score" };
  }

  /*
    The handle is a LABEL on the partner's own board, keyed by game and wallet
    upstream — not the on-chain username, and incapable of colliding with one.
    Sending it can never take a name that belongs to someone else.

    Whitespace-only is dropped rather than sent: a blank name upstream would
    replace a previously good one with nothing.
  */
  const rawHandle = body.handle;
  const handle =
    typeof rawHandle === "string" && rawHandle.trim()
      ? rawHandle.trim().slice(0, MAX_HANDLE)
      : undefined;

  return handle ? { ok: true, score, handle } : { ok: true, score };
}
