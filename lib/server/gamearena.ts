/*
  THE ONE PLACE SQUARE HOLDS ANYTHING OF GAMEARENA'S.

  A single partner key, read on the server. It is the whole authority upstream
  — whoever holds it can write any score for any wallet — so it must never
  reach a bundle, a NEXT_PUBLIC_ variable, or a response body.

  It is also the ONLY credential of theirs we hold. Their score validator key,
  their faucet key and their database credentials stay on their side, by
  design: Square can report a play and ask about a player, and can do nothing
  else.

  Shared by every route that talks to them so the config cannot drift into two
  spellings, one of which is quietly unset.
*/

const API = (process.env.GAMEARENA_API_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.GAMEARENA_PARTNER_KEY ?? "";

/** Upstream is not in a player's way: a slow board must never hold a thread
    or a screen open waiting for it. */
export const GAMEARENA_TIMEOUT_MS = 5000;

/**
 * Whether the integration is switched on at all.
 *
 * Unset config is NOT an error state. Their own partner routes stay inert
 * until a partner is configured, and ours mirror that: the game plays, the
 * card is right, and only the leaderboard write is absent — which is an
 * operator's problem and not something to interrupt a player about.
 */
export function gameArenaConfigured(): boolean {
  return API.length > 0 && KEY.length > 0;
}

/**
 * Call a partner endpoint with the key attached.
 *
 * The key is added HERE and nowhere else, so no call site can forget it and
 * no call site can log it.
 */
export function gameArenaFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "x-partner-key": KEY,
    },
    signal: AbortSignal.timeout(GAMEARENA_TIMEOUT_MS),
    cache: "no-store",
  });
}
