"use client";

import { DEMO_AUTH } from "@/lib/auth-mode";
import { currentAccessToken } from "@/lib/auth-token";
import { apiError } from "@/lib/api/envelope";
import {
  getAuthSnapshot,
  hasHeldSession,
  markSessionExpired,
  waitForAuthReady,
} from "@/lib/session";
import {
  circuitAllows,
  recordCircuitFailure,
  recordCircuitSuccess,
} from "@/lib/api/circuit-store";
import { type RateLimitScope, rateLimitScope } from "@/lib/api/circuit";
import { recordServerDate } from "@/lib/server-clock";

/**
 * Which kind of 429 this was, for the breaker only.
 *
 * READING A BODY HERE IS A COST, so it happens on exactly one status. Every
 * other failure decides on the number alone and never touches the stream, and
 * the caller still gets an untouched `response` to read itself — the clone is
 * what makes that true.
 *
 * Anything unexpected is null, which the breaker reads as "not back-pressure":
 * a body that is not JSON, a 429 from before the service grew the flag, a
 * response whose body has already gone. Guessing that direction costs a missed
 * slow-down; guessing the other one costs the app.
 */
async function failureScope(response: Response): Promise<RateLimitScope | null> {
  if (response.status !== 429) return null;
  try {
    return rateLimitScope(await response.clone().json());
  } catch {
    return null;
  }
}

// Fetch wrapper for our BFF routes. Attaches the Decane access token so the
// server can verify the caller and forward it upstream. In demo mode there is
// no session; the fixture BFF treats a tokenless request as the demo
// user, so requests go out bare.
//
// Two very different "no token" cases:
// - the session still hydrating: wait quietly for readiness, then retry the
//   token. Never surfaces to the user.
// - ready but the session is gone (expired): signal the SessionGuard
//   (which toasts once, clears cached identity and routes to /auth) and throw
//   a typed SESSION_EXPIRED so callers render a real message, not plumbing.
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  opts: {
    requireAuth?: boolean;
    /**
     * Does this request's health speak for Market Square?
     *
     * The breaker below is ONE breaker per tab, and its open state renders a
     * banner reading "Can't reach Market Square right now". That is correct for
     * `/api/market-square`, and wrong for every other upstream we proxy: the
     * KASH engine and the routing provider are separate services with separate
     * outages, and three 502s from a KASH balance poll must not tell forty
     * queries — the feed, messages, notifications — that the square is down.
     *
     * So a non-Market-Square client passes `breaker: false`. It still fails
     * honestly and its own surface goes quiet; it simply does not get a vote on
     * whether the rest of the app stops asking. Defaults true so the main
     * transport keeps exactly the behaviour it had.
     */
    breaker?: boolean;
  } = {}
): Promise<Response> {
  if (DEMO_AUTH) {
    const demo = await fetch(path, init);
    recordServerDate(demo.headers.get("date"));
    return demo;
  }

  let accessToken = currentAccessToken();

  /*
    A PUBLIC READ WAITS FOR AUTH TO SETTLE TOO, AND THAT IS NOT A LUXURY.

    `currentAccessToken()` is null "when signed out, hydrating or not mounted"
    — its own words — and only the `requireAuth` branch below ever waited out
    the hydrating case. So on a COLD REFRESH every public read fired before
    Decane had registered its token, went out with no Authorization, and the
    service answered them as an ANONYMOUS caller.

    An anonymous caller does not get the personalised fields. `isFollowing` is
    OMITTED for them by design (`hydrateFollowState` returns early on a null
    viewer), and an omitted follow edge renders as "Follow" — so the feed, the
    post cards, For You and every profile showed somebody they already follow
    as unfollowed, and stayed that way, because nothing refetched when the
    token arrived a moment later. Their own Following list was right the whole
    time: that one is an `authedGet` and DID wait.

    ogazboiz reported exactly that shape: "even though you follow and you
    refresh back, it shows you are not following — but if I check people I'm
    following, they are already there."

    The same race silently costs `likedByMe`, `bookmarkedByMe` and every other
    viewer-dependent field on a public route. This is one fix for all of them,
    at the one transport every feature goes through.

    It waits ONLY while auth has not settled. A signed-out visitor reaches
    `ready` without a token and pays nothing; a signed-in one waits out the
    hydration they were already waiting for. No request is made anonymous by a
    race that the client could have avoided.
  */
  if (!accessToken && !opts.requireAuth && !getAuthSnapshot().ready) {
    await waitForAuthReady();
    accessToken = currentAccessToken();
  }

  if (opts.requireAuth && !accessToken) {
    // Give the session a chance to finish hydrating before judging it.
    await waitForAuthReady();
    accessToken = currentAccessToken();
    if (!accessToken) {
      const { ready, authenticated } = getAuthSnapshot();
      if (ready && !authenticated) {
        /*
          AN EXPIRY AND A GUEST LOOK IDENTICAL HERE, and they are not the same
          thing. Both read `{ ready: true, authenticated: false }`; only the
          session's history separates them.

          Treating every gated 401 as an expiry meant a signed-out visitor was
          told "Session expired — sign in again" — untrue, they never had one —
          and the guard then pushed them to /auth off whatever public page they
          were reading. Since the first gated poll fires within a second of
          load, that made the front door unreachable while signed out, which
          this app explicitly supports.

          A reader who never had a session gets `UNAUTHORIZED`, which already
          means "Sign in to continue": `isAuthError` still treats it as an auth
          failure so surfaces render their sign-in state, but nothing is
          announced and nothing navigates. Gated ACTIONS still route through
          `useGate`, which is where a sign-in prompt belongs.
        */
        if (hasHeldSession()) {
          markSessionExpired();
          throw apiError("SESSION_EXPIRED", "Session expired — sign in again.", 401);
        }
        throw apiError("UNAUTHORIZED", "Sign in to continue.", 401);
      }
      // Ready-but-no-token (cold refresh race) or still not ready after the
      // wait: retryable, and queries will retry it silently.
      throw apiError("AUTH_NOT_READY", "Still connecting — try again in a moment.", 401);
    }
  }
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  /**
   * The breaker sits HERE, at the one transport every feature goes through,
   * rather than in each hook. While it is open nothing leaves the tab: no
   * network, and — because every path here is a BFF route — no serverless
   * invocation either. That second part is the one that cost money during the
   * outage; a request that never leaves is the only request that is free.
   *
   * Reads are what the breaker governs. A WRITE is the reader doing something
   * deliberate, and refusing it in-process would mean a post that silently
   * did not happen — those go out and fail honestly, and their failure still
   * informs the breaker.
   */
  const method = (init.method ?? "GET").toUpperCase();
  const watched = opts.breaker !== false;
  const governed = watched && (method === "GET" || method === "HEAD");
  if (governed && !circuitAllows()) {
    throw apiError("SERVICE_DOWN", "Can't reach Square right now.", 503);
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
    // The server's clock, for deadlines it writes (lib/server-clock.ts).
    recordServerDate(response.headers.get("date"));
  } catch (error) {
    // Transport failure: no status, nothing to read. This is the clearest
    // signal the breaker gets, so it must not be swallowed.
    if (watched) recordCircuitFailure(undefined);
    throw error;
  }
  if (response.status === 401) {
    const upgraded = await noticeUpgradedAccount(response);
    /*
      THE TOKEN WE SENT WAS REJECTED → SIGN OUT, don't resend it forever.

      A held token that comes back 401 (a stale session after the Decane
      migration, or an ordinary expiry) is dead: without this, every /me poll
      re-sends it and the console fills with 401s while the reader sits in a
      broken half-signed-in state (ogazboiz: "if i am having this issue please
      log out"). `markSessionExpired` drives the SessionGuard's logout — toast
      once, clear the cache, back to a signed-out page. A GUEST never reaches
      here (no token, handled before the fetch); ACCOUNT_UPGRADED is handled
      above and must not fire the ordinary "expired" path on top of it.
    */
    if (!upgraded && accessToken) markSessionExpired();
  }
  if (!watched) return response;
  if (response.ok) recordCircuitSuccess();
  else recordCircuitFailure(response.status, await failureScope(response));
  return response;
}

/**
 * The one 401 that is not "sign in again": ACCOUNT_UPGRADED means the service
 * has retired the sign-in this request rode on, because the account moved to
 * its upgraded one — here, or in the Market app, which shares it. The token
 * that just failed will fail identically forever, so it is dropped here
 * rather than resent on every poll, and the guard is told the real reason.
 *
 * Reads a clone: the caller still owns the body.
 */
async function noticeUpgradedAccount(response: Response): Promise<boolean> {
  let code: unknown;
  try {
    const body = (await response.clone().json()) as { error?: { code?: unknown } } | null;
    code = body?.error?.code;
  } catch {
    return false;
  }
  if (code !== "ACCOUNT_UPGRADED") return false;
  forgetLegacySession();
  markSessionExpired("upgraded");
  return true;
}

/**
 * A browser from before the move can still carry the old provider's cookie,
 * and the BFF reads it when there is no bearer. Once the service has said the
 * account moved, that cookie only buys the same refusal again.
 */
export function forgetLegacySession(): void {
  try {
    for (const name of ["privy-token", "privy-id-token"]) {
      document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
    }
  } catch {
    // No document, or cookies unavailable: nothing to forget.
  }
}
